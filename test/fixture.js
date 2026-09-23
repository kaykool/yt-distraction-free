// Builds a DOM tree that mirrors the YouTube WebComponent selectors the extension
// queries (ytd-watch-flexy, #primary/#secondary/#below, comment renderers, player
// controls, engagement panels, live chat frame). Attribute names match ytd-* elements.

function el(doc, tag, attrs = {}, text = '') {
  const n = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'id') n.id = v;
    else if (k === 'className') n.className = v;
    else n.setAttribute(k, v);
  }
  if (text) n.textContent = text;
  return n;
}

export function buildWatchPage(doc, opts = {}) {
  const {
    isLive = false,
    panelsExpanded = false,
    liveChatClosed = false,
    adsPanel = false,
    videoId = 'abc123',
    withCommentsExtras = true,
  } = opts;

  const root = el(doc, 'ytd-watch-flexy');
  if (isLive) root.setAttribute('live', '');
  if (panelsExpanded) root.setAttribute('panels-expanded', '');

  const columns = el(doc, 'div', { id: 'columns' });
  root.appendChild(columns);

  // --- primary column ---
  const primary = el(doc, 'div', { id: 'primary' });
  const primaryInner = el(doc, 'div', { id: 'primary-inner' });
  primary.appendChild(primaryInner);
  columns.appendChild(primary);

  const playerOuter = el(doc, 'div', { id: 'player-container-outer' });
  const playerInner = el(doc, 'div', { id: 'player-container-inner' });
  const player = el(doc, 'div', { id: 'player' });
  const ytdPlayer = el(doc, 'div', { id: 'ytd-player' });
  const moviePlayer = el(doc, 'div', { id: 'movie_player', className: 'html5-video-player' });
  const video = el(doc, 'video');
  const rightControls = el(doc, 'div', { className: 'ytp-right-controls' });
  const autonav = el(doc, 'div', { className: 'ytp-autonav-toggle-button-container' });
  rightControls.appendChild(autonav);
  moviePlayer.appendChild(video);
  moviePlayer.appendChild(rightControls);
  ytdPlayer.appendChild(moviePlayer);
  player.appendChild(ytdPlayer);
  playerInner.appendChild(player);
  playerOuter.appendChild(playerInner);
  primaryInner.appendChild(playerOuter);

  const below = el(doc, 'div', { id: 'below' });
  primaryInner.appendChild(below);

  const metadata = el(doc, 'ytd-watch-metadata');
  below.appendChild(metadata);

  const lifecycle = el(doc, 'ytd-video-primary-info-renderer');
  below.appendChild(lifecycle);

  // --- secondary column ---
  const secondary = el(doc, 'div', { id: 'secondary' });
  const secondaryInner = el(doc, 'div', { id: 'secondary-inner' });
  const related = el(doc, 'ytd-watch-next-secondary-results-renderer', { id: 'related' });
  secondaryInner.appendChild(related);

  // Real YouTube only mounts a live-chat frame for streams that actually have chat.
  const chatFrame = isLive ? el(doc, 'ytd-live-chat-frame') : null;
  const chatIframe = isLive ? el(doc, 'iframe', { id: 'chatframe' }) : null;
  if (liveChatClosed && chatFrame) chatFrame.setAttribute('collapsed', '');
  if (liveChatClosed && chatIframe) chatIframe.hidden = true;
  if (chatFrame) secondaryInner.appendChild(chatFrame);
  if (chatIframe) secondaryInner.appendChild(chatIframe);
  secondary.appendChild(secondaryInner);
  columns.appendChild(secondary);

  // --- comments (a lazy renderer that only populates once revealed) ---
  const commentsSection = el(doc, 'ytd-item-section-renderer', { 'section-identifier': 'comment-item-section' });
  const commentsHost = el(doc, 'ytd-comments', { id: 'comments' });
  const continuation = el(doc, 'ytd-continuation-item-renderer');
  const contBtn = el(doc, 'button', {}, 'Load more');
  continuation.appendChild(contBtn);
  commentsHost.appendChild(continuation);
  // Mirror real DOM: #comments lives inside #below, after ytd-watch-metadata.
  below.appendChild(commentsHost);

  // --- engagement panels ---
  const commentsPanel = el(doc, 'ytd-engagement-panel-section-list-renderer', { 'target-id': 'engagement-panel-comments-section' });
  const adsPanelEl = el(doc, 'ytd-engagement-panel-section-list-renderer', { 'target-id': 'engagement-panel-ads' });
  if (adsPanel) adsPanelEl.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  const askPanel = el(doc, 'ytd-engagement-panel-section-list-renderer', { 'target-id': 'engagement-panel-structured-description' });

  const panels = el(doc, 'div', { id: 'panels' });
  panels.appendChild(commentsPanel);
  panels.appendChild(adsPanelEl);
  panels.appendChild(askPanel);
  secondaryInner.appendChild(panels);

  const infoSection = el(doc, 'ytd-structured-description-content-renderer', { id: 'info-contents' });
  return {
    root, columns, primary, primaryInner, below, metadata, secondary, secondaryInner,
    related, chatFrame, chatIframe, moviePlayer, rightControls, autonav, video, playerOuter,
    commentsSection, commentsHost, contBtn, commentsPanel, adsPanelEl, askPanel, infoSection,
    isLive,
  };
}

// Simulates the deferred async population YouTube performs after a continuation
// request resolves: real comment renderers get appended into #comments.
export function populateComments(doc, parts, count = 20) {
  for (let i = 0; i < count; i++) {
    parts.commentsHost.appendChild(el(doc, 'ytd-comment-thread-renderer', {}, `comment ${i}`));
  }
}

// Reveal the collapsed engagement panel the way YouTube does after a user click.
export function expandPanel(parts, which = 'comments') {
  const panel = which === 'comments' ? parts.commentsPanel : parts.askPanel;
  panel.setAttribute('visibility', 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED');
  return panel;
}

export function collapseChat(parts) {
  parts.chatFrame.setAttribute('collapsed', '');
  parts.chatIframe.hidden = true;
}
