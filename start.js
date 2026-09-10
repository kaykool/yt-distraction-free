// Runs at document_start to hide comments before first paint on direct watch/live loads.
// In-app SPA navigation and button placement are handled in comments.js.
(() => {
  const path = location.pathname;
  if (path.startsWith('/watch') || path.startsWith('/live')) {
    document.documentElement.classList.add('ytlite-comments-hide');
  }
  if (path.startsWith('/live')) {
    document.documentElement.classList.add('ytlite-live');
    document.documentElement.classList.add('ytlite-sidebar-active');
  }
})();


