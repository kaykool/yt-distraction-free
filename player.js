// Runs in MAIN world to directly set YouTube player quality without UI clicks
(() => {
  function applyQuality(target) {
    const player = document.getElementById('movie_player');
    if (!player) return;
    const q = target === '144' ? 'tiny' : 'large';
    // setPlaybackQuality delegates to the range call in current builds — call one, not both.
    if (typeof player.setPlaybackQualityRange === 'function') {
      player.setPlaybackQualityRange(q, q);
    } else if (typeof player.setPlaybackQuality === 'function') {
      player.setPlaybackQuality(q);
    }
  }

  // Read shared localStorage instead of CustomEvent.detail: detail does not
  // survive the ISOLATED -> MAIN world boundary and arrives null.
  window.addEventListener('ytlite-set-quality', () => {
    try {
      const blocked = localStorage.getItem('ytlite-block-video') === 'true';
      applyQuality(blocked ? '144' : '480');
    } catch (_) {}
  });

  // Click bridge: the AO/VO button is created by comments.js in the ISOLATED
  // world. Catch its clicks here in the MAIN world so the quality change does
  // not depend on cross-world CustomEvent delivery. Capture phase runs before
  // the button handler; setTimeout(0) reads localStorage after it is written.
  document.addEventListener('click', (e) => {
    const btn = e.target && typeof e.target.closest === 'function'
      ? e.target.closest('.ytlite-video-toggle-btn')
      : null;
    if (!btn) return;
    setTimeout(() => {
      try {
        applyQuality(localStorage.getItem('ytlite-block-video') === 'true' ? '144' : '480');
      } catch (_) {}
    }, 0);
  }, true);

  window.addEventListener('yt-navigate-finish', () => {
    try {
      const isBlocked = localStorage.getItem('ytlite-block-video') === 'true';
      setTimeout(() => applyQuality(isBlocked ? '144' : '480'), 600);
    } catch (_) {}
  });
})();
