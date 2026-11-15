# Dual-World Content Script Bridge

YT Lite splits its content scripts across Chromium's `ISOLATED` world (`start.js`, `comments.js`) for DOM layout and UI controls, and the `MAIN` world (`player.js`) for YouTube's custom-element prototype methods and `#movie_player` playback API.

Because page-JS expandos (`getVideoData`, `setPlaybackQualityRange`, `setCollapsedState`, `onShowHideChat`) only exist in the `MAIN` world while extension DOM observers live in the `ISOLATED` world, they coordinate through:

- **`<html>` attributes (`player.js` -> `comments.js`)**: `data-ytlite-live`, `data-ytlite-video`, `data-ytlite-replay`
- **`window` custom events (`player.js` -> `comments.js`)**: `ytlite-live-state`, `ytlite-chat-opened`
- **`window` custom events (`comments.js` -> `player.js`)**: `ytlite-set-quality`, `ytlite-open-chat`
- **Shared `localStorage`**: `ytlite-block-video`, `ytlite-prev-quality`
