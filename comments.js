// Reveal comments on demand. No fetch happens while hidden.
(() => {
  let buttonContainer = null;
  let observer = null;
  let observerTarget = null;
  let observerSafetyTimer = null;

  function isWatchPage() {
    const path = location.pathname;
    return path.startsWith('/watch') || path.startsWith('/live');
  }

  const hasAttr = (el, attr) =>
    Boolean(
      el && typeof el.hasAttribute === 'function' && el.hasAttribute(attr)
    );
  const getAttr = (el, attr) =>
    el && typeof el.getAttribute === 'function' ? el.getAttribute(attr) : null;

  let cachedVideoId = null;
  let cachedIsLive = false;
  let cachedDefinitive = false; // true when cachedIsLive came from an authoritative source

  // Live status supplied by YouTube's own lifecycle payloads. Authoritative and
  // free, so it is preferred over any DOM inspection.
  let eventLiveSignal = null; // { videoId, isLive }

  function videoIdFromUrl() {
    const match = location.search && location.search.match(/[?&]v=([^&#]+)/);
    if (match) return match[1];
    const liveMatch =
      location.pathname && location.pathname.match(/^\/live\/([^/?#]+)/);
    return liveMatch ? liveMatch[1] : null;
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
    const currentVideoId = videoIdFromUrl();
    const root = document.documentElement;
    const replayFor = getAttr(root, 'data-ytlite-replay');
    const isPublishedReplay = Boolean(
      replayFor &&
      (!currentVideoId || replayFor === 'true' || replayFor === currentVideoId)
    );

    // 1. Authoritative: YouTube told us via yt-navigate-finish / yt-page-data-updated.
    //    Checked before /live path checks and caches so Stream Replays on /live/<id>
    //    and late payloads always win over tentative heuristics.
    if (eventLiveSignal && eventLiveSignal.videoId === currentVideoId) {
      return cacheLive(currentVideoId, eventLiveSignal.isLive);
    }

    // 2. Authoritative Stream Replay marker published by MAIN-world player.js.
    //    Checked before /live path checks, cache, and DOM stamp cues so archived
    //    replays never leak into Live Stream layout.
    if (isPublishedReplay) {
      return cacheLive(currentVideoId, false);
    }

    if (location.pathname.startsWith('/live')) return true;

    // 3. A definitive answer for this video id is stable. Only *definitive* results
    //    are trusted: an early probe on a not-yet-hydrated page can miss a live
    //    stream, so those indeterminate negatives must not be cached.
    if (
      currentVideoId &&
      cachedVideoId === currentVideoId &&
      cachedDefinitive
    ) {
      return cachedIsLive;
    }

    // 4. Cheap, stable DOM attributes — but only when they describe the video in
    //    the URL. ytd-watch-flexy is reused across SPA navigations and can drop or
    //    retain the previous video's video-id and [live]/[should-stamp-chat] attributes
    //    across a transition, so require an exact video-id match whenever present.
    const watchEl = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    const domVideoId = getAttr(watchEl, 'video-id');
    const domIsCurrent =
      Boolean(watchEl) && (!currentVideoId || domVideoId === currentVideoId);
    if (
      domIsCurrent &&
      (hasAttr(watchEl, 'live') || hasAttr(watchEl, 'is-live'))
    ) {
      return cacheLive(currentVideoId, true);
    }

    // Chat-stamp attributes appear on both Live Streams and Stream Replays, so keep
    // them non-definitive until authoritative Replay/Live metadata resolves.
    if (
      domIsCurrent &&
      (hasAttr(watchEl, 'live-chat-present-and-expanded') ||
        hasAttr(watchEl, 'should-stamp-chat'))
    ) {
      return cacheLive(currentVideoId, true, false);
    }

    const badge = document.querySelector('.ytp-live-badge');
    if (
      domIsCurrent &&
      badge &&
      !hasAttr(badge, 'hidden') &&
      !badge.hidden &&
      (hasAttr(badge, 'disabled') ||
        hasAttr(badge, 'data-tooltip-title') ||
        hasAttr(badge, 'aria-label') ||
        (badge.classList &&
          badge.classList.contains('ytp-live-badge-is-livehead')))
    ) {
      return cacheLive(currentVideoId, true);
    }

    if (
      domIsCurrent &&
      document.querySelector(
        '.ytp-time-display.ytp-live, .html5-video-player.ytp-live'
      )
    ) {
      return cacheLive(currentVideoId, true);
    }

    // 5. Player API, via the flag player.js (MAIN world) publishes on <html>.
    //    The player object's methods are page-JS expandos and do not exist in this
    //    world, so the player cannot be asked directly from here. Only a positive
    //    answer is ever published there; absence means "no authoritative answer".
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

  function isLiveChatClosed(
    chatFrame = document.querySelector('ytd-live-chat-frame, #chat')
  ) {
    if (!chatFrame) return false;
    return (
      hasAttr(chatFrame, 'collapsed') ||
      hasAttr(chatFrame, 'hidden') ||
      hasAttr(chatFrame, 'hide-chat-frame')
    );
  }

  // YouTube renders an availability message inside the collapsed chat frame when
  // chat is disabled for the stream. The frame is otherwise indistinguishable
  // from a user-hidden chat, so this is the only cheap way to avoid offering a
  // Show chat button that opens an empty panel.
  function isChatUnavailable(
    chatFrame = document.querySelector('ytd-live-chat-frame, #chat')
  ) {
    return Boolean(
      chatFrame && chatFrame.querySelector('ytd-message-renderer')
    );
  }

  function isSidebarNeeded(watch = isWatchPage(), isLive = isLiveVideo()) {
    if (!watch) return false;

    // The sidebar only earns its space when it has content to show. A live video
    // with no chat would otherwise reserve ~400px of column that hide.css empties
    // (the related-video list is hidden), leaving a blank gutter next to the player.
    // Chat Replay mounts uncollapsed by default on YouTube replays, so only active
    // Live Streams auto-open the Sidebar for chat.
    if (isLive) {
      const chatFrame = document.querySelector('ytd-live-chat-frame, #chat');
      if (chatFrame) {
        if (!isLiveChatClosed(chatFrame) && !isChatUnavailable(chatFrame))
          return true;
      } else {
        // Live chat can also be mounted as a bare iframe before its frame element
        // exists. Only then is the iframe's own hidden state meaningful: YouTube
        // hides chat by collapsing the frame element and leaves #chatframe unhidden,
        // so checking the iframe alongside a collapsed frame would keep the sidebar
        // open (and suppress the Show chat button) after the user hides chat, or
        // after navigating away from a live video whose frame is still mounted.
        const chatIframe = document.getElementById('chatframe');
        if (chatIframe && !chatIframe.hidden) return true;
      }
    }

    // panels-expanded is only set once a panel is genuinely open.
    const watchEl = document.querySelector('ytd-watch-flexy, ytd-watch-grid');
    if (watchEl && hasAttr(watchEl, 'panels-expanded')) return true;

    // Engagement panels (Ask AI, conversational AI, transcripts, chapters, etc.)
    const panels = document.querySelectorAll(
      'ytd-engagement-panel-section-list-renderer'
    );
    const commentsHidden = document.documentElement.classList.contains(
      'ytlite-comments-hide'
    );
    for (let i = 0; i < panels.length; i++) {
      const p = panels[i];
      const targetId = (
        getAttr(p, 'target-id') ||
        getAttr(p, 'data-target-id') ||
        ''
      ).toLowerCase();
      if (targetId.includes('ad') || targetId.includes('sponsor')) continue;
      if (commentsHidden && targetId.includes('comment')) continue;

      const vis = getAttr(p, 'visibility');
      const isExpanded =
        vis === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED' ||
        vis === 'ENGAGEMENT_PANEL_VISIBILITY_VISIBLE' ||
        hasAttr(p, 'opened') ||
        hasAttr(p, 'expanded') ||
        hasAttr(p, 'is-expanded') ||
        (Boolean(vis) && !vis.includes('HIDDEN'));
      const isHidden =
        hasAttr(p, 'hidden') || vis === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN';

      if (isExpanded && !isHidden) {
        return true;
      }
    }

    return false;
  }

  function updateSidebarState(state) {
    const watch = state?.watch !== undefined ? state.watch : isWatchPage();
    if (!watch) {
      document.documentElement.classList.remove(
        'ytlite-live',
        'ytlite-sidebar-active'
      );
      removeExistingButton();
      return { watch: false, isLive: false, needSidebar: false, placed: false };
    }

    const wasLive = document.documentElement.classList.contains('ytlite-live');
    const isLive = state?.isLive !== undefined ? state.isLive : isLiveVideo();
    if (isLive) {
      document.documentElement.classList.add('ytlite-live');
      document.documentElement.classList.remove('ytlite-comments-hide');
      disconnectObserver();
    } else {
      document.documentElement.classList.remove('ytlite-live');
      if (wasLive) {
        document.documentElement.classList.add('ytlite-comments-hide');
      }
    }

    const needSidebar = isSidebarNeeded(watch, isLive);
    let placed = false;
    if (needSidebar) {
      document.documentElement.classList.add('ytlite-sidebar-active');
      if (isLive) {
        removeExistingButton();
      } else {
        placed = place({ watch, isLive });
      }
    } else {
      document.documentElement.classList.remove('ytlite-sidebar-active');
      placed = place({ watch, isLive });
    }
    return { watch, isLive, needSidebar, placed };
  }

  const PANEL_OR_CHAT_SELECTOR =
    'ytd-engagement-panel-section-list-renderer, #panels, ytd-live-chat-frame, #chat';
  let hydrationTimers = [];
  let sidebarUpdateTimers = [];
  let panelObserver = null;
  let panelObserverSafetyTimer = null;
  let chatObserver = null;
  let chatObserverTarget = null;
  let chatObserverSafetyTimer = null;

  function clearHydrationTimers() {
    hydrationTimers.forEach(clearTimeout);
    hydrationTimers = [];
  }

  function clearSidebarTimers() {
    sidebarUpdateTimers.forEach(clearTimeout);
    sidebarUpdateTimers = [];
  }

  function disconnectPanelObserver() {
    if (panelObserver) {
      panelObserver.disconnect();
      panelObserver = null;
    }
    if (panelObserverSafetyTimer) {
      clearTimeout(panelObserverSafetyTimer);
      panelObserverSafetyTimer = null;
    }
  }

  function disconnectChatObserver() {
    if (chatObserver) {
      chatObserver.disconnect();
      chatObserver = null;
    }
    chatObserverTarget = null;
    if (chatObserverSafetyTimer) {
      clearTimeout(chatObserverSafetyTimer);
      chatObserverSafetyTimer = null;
    }
  }

  function startScopedChatObserver() {
    if (!isWatchPage()) {
      disconnectChatObserver();
      return;
    }
    if (document.querySelector('ytd-live-chat-frame, #chat')) {
      disconnectChatObserver();
      return;
    }
    const target =
      document.getElementById('secondary-inner') ||
      document.getElementById('secondary');
    if (!target) {
      disconnectChatObserver();
      return;
    }
    if (chatObserver && chatObserverTarget === target && target.isConnected) {
      return;
    }
    disconnectChatObserver();
    chatObserverTarget = target;
    chatObserver = new MutationObserver(() => {
      if (!isWatchPage()) {
        disconnectChatObserver();
        return;
      }
      if (document.querySelector('ytd-live-chat-frame, #chat')) {
        disconnectChatObserver();
        syncWatchUi();
      }
    });
    chatObserver.observe(target, { childList: true, subtree: false });

    chatObserverSafetyTimer = setTimeout(() => {
      disconnectChatObserver();
    }, 4000);
  }

  function observePanelOrChatTransition(target) {
    disconnectPanelObserver();
    if (!isWatchPage() || !target || !target.isConnected) return;

    const options =
      target.id === 'panels'
        ? { childList: true, attributes: true, subtree: false }
        : {
            attributes: true,
            attributeFilter: [
              'visibility',
              'hidden',
              'opened',
              'expanded',
              'is-expanded',
              'collapsed',
              'hide-chat-frame',
            ],
            subtree: false,
          };

    panelObserver = new MutationObserver(() => {
      disconnectPanelObserver();
      clearSidebarTimers();
      syncWatchUi();
    });
    panelObserver.observe(target, options);

    panelObserverSafetyTimer = setTimeout(() => {
      disconnectPanelObserver();
    }, 600);
  }

  function scheduleSidebarUpdate() {
    if (!isWatchPage()) return;
    clearSidebarTimers();
    sidebarUpdateTimers.push(setTimeout(() => syncWatchUi(), 150));
    sidebarUpdateTimers.push(setTimeout(() => syncWatchUi(), 600));
  }

  function handlePanelLifecycleEvent(e) {
    if (!isWatchPage()) return;
    const target = e?.target;
    const panelOrChat =
      target && typeof target.closest === 'function'
        ? target.closest(PANEL_OR_CHAT_SELECTOR)
        : null;
    if (panelOrChat) observePanelOrChatTransition(panelOrChat);
    scheduleSidebarUpdate();
  }

  function handlePanelAction(e) {
    if (!isWatchPage()) return;
    const target = e?.target;
    const panelOrChat =
      target && typeof target.closest === 'function'
        ? target.closest(PANEL_OR_CHAT_SELECTOR)
        : null;
    if (!panelOrChat) return;
    observePanelOrChatTransition(panelOrChat);
    scheduleSidebarUpdate();
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

  function isLiveUrl(url) {
    if (!url) return false;
    try {
      return new URL(url, location.origin).pathname.startsWith('/live');
    } catch (_) {
      return false;
    }
  }

  function disconnectObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    observerTarget = null;
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

    // Trigger the continuation element's own button if it is mounted. Scoped to
    // ytd-continuation-item-renderer on purpose: a bare [role="button"] inside
    // #comments can match the sort menu or a reply toggle, and clicking that would
    // open a menu instead of loading comments.
    const continuation = comments.querySelector(
      'ytd-continuation-item-renderer'
    );
    const loadBtn =
      continuation &&
      continuation.querySelector('button, tp-yt-paper-button, [role="button"]');
    if (loadBtn && typeof loadBtn.click === 'function') {
      loadBtn.click();
    }

    // Direct continuation dispatch for instant comment loading
    try {
      comments.dispatchEvent(
        new CustomEvent('yt-load-next-continuation', { bubbles: true })
      );
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

  function findLiveChatToggleButton() {
    const showBtns = document.querySelectorAll(
      '#show-hide-button button, [aria-label="Show chat"]'
    );
    for (let i = 0; i < showBtns.length; i++) {
      const el = showBtns[i];
      if (
        (el.classList && el.classList.contains('ytlite-comments-btn')) ||
        (typeof el.closest === 'function' &&
          el.closest('.ytlite-button-container'))
      ) {
        continue;
      }
      const label = (
        getAttr(el, 'aria-label') ||
        el.textContent ||
        ''
      ).toLowerCase();
      if (label.includes('hide')) continue;
      return el;
    }

    return document.querySelector(
      '#teaser-carousel button, yt-video-metadata-carousel-view-model [role="button"], yt-video-metadata-carousel-view-model button'
    );
  }

  function applyChatOpenedState() {
    if (!isWatchPage()) return;
    const chat = document.querySelector('ytd-live-chat-frame, #chat');
    if (chat) {
      chat.removeAttribute('collapsed');
      chat.removeAttribute('hidden');
      chat.removeAttribute('hide-chat-frame');
    }
    document.documentElement.classList.add('ytlite-sidebar-active');
    removeExistingButton();
    disconnectObserver();
    scheduleSidebarUpdate();
  }

  function openLiveChat() {
    // Custom-element methods (setCollapsedState / onShowHideChat) live on the page
    // world prototypes, so the request is handed to player.js first.
    let handledByMain = false;
    const onOpened = () => {
      handledByMain = true;
    };
    window.addEventListener('ytlite-chat-opened', onOpened);
    try {
      window.dispatchEvent(new CustomEvent('ytlite-open-chat'));
    } catch (_) {
    } finally {
      window.removeEventListener('ytlite-chat-opened', onOpened);
    }

    // Only click a single UI fallback toggle if MAIN world did not already open chat.
    if (!handledByMain) {
      const chat = document.querySelector('ytd-live-chat-frame, #chat');
      if (!chat || isLiveChatClosed(chat)) {
        const toggleBtn = findLiveChatToggleButton();
        if (toggleBtn) {
          try {
            toggleBtn.click();
          } catch (_) {}
        }
      }
      applyChatOpenedState();
    }
  }

  let isPlacing = false;

  function needsRevealButton(watch = isWatchPage(), isLive = isLiveVideo()) {
    if (!watch) return false;
    const liveActive =
      isLive || document.documentElement.classList.contains('ytlite-live');
    if (liveActive) {
      return (
        !document.documentElement.classList.contains('ytlite-sidebar-active') &&
        isLiveChatClosed() &&
        !isChatUnavailable()
      );
    }
    return document.documentElement.classList.contains('ytlite-comments-hide');
  }

  function isHiddenSidebarNode(el) {
    return Boolean(
      el &&
      typeof el.closest === 'function' &&
      el.closest('#secondary, #panels')
    );
  }

  function queryVisibleMountTarget(selector) {
    const matches = document.querySelectorAll(selector);
    for (let i = 0; i < matches.length; i++) {
      if (!isHiddenSidebarNode(matches[i])) return matches[i];
    }
    return null;
  }

  function findMountTarget(isLive) {
    if (!isLive) {
      const commentsEl = queryVisibleMountTarget(
        '#comments, ytd-comments, ytd-item-section-renderer[section-identifier="comment-item-section"]'
      );
      if (commentsEl) return { el: commentsEl, fallback: false };
    }
    const metaEl = queryVisibleMountTarget(
      'ytd-watch-metadata, #below ytd-watch-metadata'
    );
    if (metaEl) return { el: metaEl, fallback: false };

    const below = queryVisibleMountTarget('#below');
    if (below && below.children.length > 0) {
      return { el: below, fallback: false };
    }

    const colFallback =
      queryVisibleMountTarget('#primary-inner') ||
      queryVisibleMountTarget('#primary');
    if (colFallback && colFallback.children.length > 0) {
      return { el: colFallback, fallback: true };
    }
    return null;
  }

  function place(state) {
    if (isPlacing) return false;
    const watch = state?.watch !== undefined ? state.watch : isWatchPage();
    if (!watch) {
      removeExistingButton();
      disconnectObserver();
      return false;
    }

    const isLive =
      (state?.isLive !== undefined ? state.isLive : isLiveVideo()) ||
      document.documentElement.classList.contains('ytlite-live');
    if (isLive) {
      if (
        document.documentElement.classList.contains('ytlite-sidebar-active') ||
        !isLiveChatClosed()
      ) {
        removeExistingButton();
        disconnectObserver();
        return false;
      }
      if (isChatUnavailable()) {
        removeExistingButton();
        disconnectObserver();
        return false;
      }
    } else {
      if (
        !document.documentElement.classList.contains('ytlite-comments-hide')
      ) {
        removeExistingButton();
        disconnectObserver();
        return false;
      }
    }

    // The button's mode is part of its identity: a same-page live-state flip must
    // replace "Show comments" with "Show chat" (or vice versa), not reuse it.
    const mode = isLive ? 'chat' : 'comments';

    let existing =
      buttonContainer && buttonContainer.isConnected ? buttonContainer : null;
    if (!existing) {
      const found = document.querySelector('.ytlite-button-container');
      if (found && found.isConnected) existing = found;
    }

    let resolvedTarget = null;
    if (existing) {
      const sameMode = getAttr(existing, 'data-ytlite-mode') === mode;
      const inHiddenSidebar = isHiddenSidebarNode(existing);
      if (sameMode && !inHiddenSidebar) {
        if (!hasAttr(existing, 'data-ytlite-fallback')) {
          buttonContainer = existing;
          return true;
        }
        resolvedTarget = findMountTarget(isLive);
        if (!resolvedTarget || resolvedTarget.fallback) {
          buttonContainer = existing;
          return true;
        }
      }
      removeExistingButton();
    }

    // Find the best visible mount target outside hidden #secondary / #panels.
    const targetInfo = resolvedTarget || findMountTarget(isLive);
    const targetEl = targetInfo?.el;
    const isFallback = Boolean(targetInfo?.fallback);

    if (!targetEl || !targetEl.parentElement) return false;

    isPlacing = true;
    try {
      removeExistingButton();

      const container = document.createElement('div');
      container.className = 'ytlite-button-container';
      container.setAttribute('data-ytlite-mode', mode);
      if (isFallback) {
        container.setAttribute('data-ytlite-fallback', 'true');
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ytlite-comments-btn';
      btn.setAttribute('aria-expanded', 'false');
      if (isLive) {
        btn.textContent = 'Show chat';
        btn.addEventListener('click', openLiveChat, { once: true });
      } else {
        btn.textContent = 'Show comments';
        btn.addEventListener('click', revealComments, { once: true });
      }

      container.appendChild(btn);

      if (targetEl.id === 'below' || isFallback) {
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
    if (!needsRevealButton()) {
      disconnectObserver();
      return;
    }
    if (buttonContainer && buttonContainer.isConnected) {
      disconnectObserver();
      return;
    }

    // Scope observer strictly to watch/app-shell containers with subtree: false.
    // This completely ignores internal player mutations (buffering, timecode, subtitles).
    const targetSelectors = [
      '#below',
      '#primary-inner',
      '#primary',
      'ytd-watch-flexy, ytd-watch-grid',
      'ytd-page-manager, #page-manager',
      'ytd-app',
    ];
    let target = null;
    for (const sel of targetSelectors) {
      const candidate = document.querySelector(sel);
      if (candidate && candidate.isConnected) {
        target = candidate;
        break;
      }
    }
    if (!target) {
      disconnectObserver();
      return;
    }
    if (observer && observerTarget === target && target.isConnected) {
      return;
    }

    disconnectObserver();
    observerTarget = target;
    observer = new MutationObserver(() => {
      if (!needsRevealButton()) {
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

    observer.observe(target, { childList: true, subtree: false });

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
    const isBlocked = document.documentElement.classList.contains(
      'ytlite-video-blocked'
    );
    btn.setAttribute('aria-label', 'AudioOnly');
    btn.setAttribute(
      'title',
      isBlocked
        ? 'Unblock video (currently AudioOnly)'
        : 'Block video (switch to AudioOnly)'
    );
    btn.setAttribute('aria-pressed', isBlocked ? 'true' : 'false');
    btn.textContent = 'AudioOnly';
    btn.classList.toggle('ytlite-ao', isBlocked);
  }

  function placeVideoToggleButton(watch = isWatchPage()) {
    if (!watch) {
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
      const nextBlocked = !document.documentElement.classList.contains(
        'ytlite-video-blocked'
      );
      document.documentElement.classList.toggle(
        'ytlite-video-blocked',
        nextBlocked
      );
      try {
        localStorage.setItem(
          'ytlite-block-video',
          nextBlocked ? 'true' : 'false'
        );
      } catch (_) {}
      updateVideoBtnState(btn);
      window.dispatchEvent(new CustomEvent('ytlite-set-quality'));
    });

    // Ensure we find the top-level container inside rightControls, not an inner child
    const autonavContainer = rightControls.querySelector(
      '.ytp-autonav-toggle-button-container'
    );
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

    // Query the player container list in order from narrowest to widest without
    // falling back to #primary-inner, which would observe comment/metadata mutations.
    const targetSelectors = [
      '.html5-video-player',
      '#movie_player',
      '#ytd-player',
      '#player',
      '#player-container-outer',
    ];
    let target = null;
    for (const sel of targetSelectors) {
      target = document.querySelector(sel);
      if (target) break;
    }
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

  function initVideoToggle(watch = isWatchPage(), syncQuality = false) {
    if (!watch) {
      disconnectVideoObserver();
      return;
    }
    if (!placeVideoToggleButton(watch)) {
      startScopedVideoObserver();
    }
    if (syncQuality) {
      window.dispatchEvent(new CustomEvent('ytlite-set-quality'));
    }
  }

  function syncWatchUi(state) {
    const res = updateSidebarState(state);
    if (!res.watch) {
      disconnectChatObserver();
      disconnectObserver();
      return res;
    }

    const liveActive =
      res.isLive || document.documentElement.classList.contains('ytlite-live');
    if (liveActive && !document.querySelector('ytd-live-chat-frame, #chat')) {
      startScopedChatObserver();
    } else {
      disconnectChatObserver();
    }

    if (needsRevealButton(res.watch, res.isLive) && !res.placed) {
      startScopedObserver();
    } else {
      disconnectObserver();
    }
    return res;
  }

  function init(state) {
    const syncQuality = state === true || Boolean(state?.syncQuality);
    const watch = state?.watch !== undefined ? state.watch : isWatchPage();
    clearHydrationTimers();
    clearSidebarTimers();
    disconnectChatObserver();
    disconnectObserver();

    if (!watch) {
      disconnectVideoObserver();
      disconnectPanelObserver();
      removeExistingButton();
      document.documentElement.classList.remove(
        'ytlite-sidebar-active',
        'ytlite-live'
      );
      return;
    }

    initVideoToggle(watch, syncQuality);

    syncWatchUi({
      watch,
      isLive: state?.isLive,
    });

    // Catch deferred custom element hydration (chat frame, disabled message, comments)
    // on cold loads and SPA transitions.
    hydrationTimers.push(setTimeout(() => syncWatchUi(), 300));
    hydrationTimers.push(setTimeout(() => syncWatchUi(), 1200));
    hydrationTimers.push(setTimeout(() => syncWatchUi(), 3000));
  }

  function handleNavigateStart(e) {
    clearHydrationTimers();
    clearSidebarTimers();
    disconnectPanelObserver();
    disconnectChatObserver();
    cachedVideoId = null;
    cachedIsLive = false;
    cachedDefinitive = false;
    eventLiveSignal = null;
    const navUrl = getUrlFromEvent(e);
    const willBeWatch = navUrl ? isWatchUrl(navUrl) : isWatchPage();
    if (willBeWatch) {
      if (navUrl && isLiveUrl(navUrl)) {
        document.documentElement.classList.remove('ytlite-comments-hide');
        document.documentElement.classList.add(
          'ytlite-live',
          'ytlite-sidebar-active'
        );
      } else {
        document.documentElement.classList.add('ytlite-comments-hide');
        if (navUrl) {
          document.documentElement.classList.remove('ytlite-live');
          document.documentElement.classList.remove('ytlite-sidebar-active');
        }
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

  function extractEventLiveSignal(e) {
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

    if (vd && typeof vd === 'object') {
      if (vd.isLive === true) return { isLive: true, isReplay: false };
      if (vd.isLiveContent === true) return { isLive: false, isReplay: true };
      if ('isLive' in vd || Object.keys(vd).length > 0)
        return { isLive: false, isReplay: false };
    }

    if (chatRenderer && typeof chatRenderer === 'object') {
      if (
        chatRenderer.isReplay === true ||
        chatRenderer.liveChatRenderer?.isReplay === true
      ) {
        return { isLive: false, isReplay: true };
      }
      return { isLive: true, isReplay: false };
    }

    return null;
  }

  function handleNavigateFinish(e) {
    clearHydrationTimers();
    clearSidebarTimers();
    disconnectPanelObserver();
    disconnectChatObserver();
    const signal = extractEventLiveSignal(e);
    const videoId = videoIdFromUrl();
    if (videoId && signal) {
      // Record the authoritative signal so isLiveVideo() never has to scan scripts.
      eventLiveSignal = {
        videoId,
        isLive: signal.isLive,
        isReplay: signal.isReplay,
      };
      cacheLive(videoId, signal.isLive, true);
    }

    const watch = isWatchPage();
    if (!watch) {
      document.documentElement.classList.remove('ytlite-comments-hide');
      init({ watch: false });
      return;
    }

    const isLive = signal ? signal.isLive : isLiveVideo();
    if (isLive) {
      document.documentElement.classList.add('ytlite-live');
      document.documentElement.classList.remove('ytlite-comments-hide');
    } else {
      document.documentElement.classList.remove('ytlite-live');
      document.documentElement.classList.add('ytlite-comments-hide');
    }
    init({ watch: true, isLive });
  }

  function handleDataUpdated(e) {
    const signal = extractEventLiveSignal(e);
    const videoId = videoIdFromUrl();
    if (videoId && signal) {
      eventLiveSignal = {
        videoId,
        isLive: signal.isLive,
        isReplay: signal.isReplay,
      };
      cacheLive(videoId, signal.isLive, true);
    }
    const { watch } = syncWatchUi();
    if (!watch) return;
    placeVideoToggleButton(watch);
  }

  init(true);
  document.addEventListener('yt-navigate-start', handleNavigateStart);
  document.addEventListener('yt-navigate-finish', handleNavigateFinish);
  document.addEventListener('yt-page-data-updated', handleDataUpdated);
  window.addEventListener('ytlite-live-state', () => {
    syncWatchUi();
  });
  window.addEventListener('ytlite-chat-opened', applyChatOpenedState);
  window.addEventListener('popstate', handleNavigateFinish);
  document.addEventListener(
    'yt-engagement-panel-visibility-changed',
    handlePanelLifecycleEvent,
    { passive: true }
  );
  document.addEventListener(
    'yt-visibility-refresh',
    handlePanelLifecycleEvent,
    { passive: true }
  );
  document.addEventListener(
    'yt-chat-collapsed-changed',
    handlePanelLifecycleEvent,
    { passive: true }
  );
  document.addEventListener('yt-action', handlePanelAction, {
    capture: true,
    passive: true,
  });
})();
