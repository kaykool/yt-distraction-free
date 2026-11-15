// Runs at document_start to hide comments on watch loads and pre-mark live routes before first paint.
// In-app SPA navigation and button placement are handled in comments.js.
(() => {
  const path = location.pathname;
  const isWatch = path.startsWith('/watch');
  const isLive = path.startsWith('/live');
  if (isWatch) {
    document.documentElement.classList.add('ytlite-comments-hide');
  }
  if (isLive) {
    document.documentElement.classList.add(
      'ytlite-live',
      'ytlite-sidebar-active'
    );
  }
  if (isWatch || isLive) {
    try {
      if (localStorage.getItem('ytlite-block-video') === 'true') {
        document.documentElement.classList.add('ytlite-video-blocked');
      }
    } catch (_) {}
  }
})();
