# AGENTS.md — YT Lite Project Guidelines

YT Lite is a high-performance, distraction-free Chrome extension (MV3) built to run YouTube smoothly on resource-constrained laptops.

## 1. Core Principles

- **Ultra-Low Overhead**: Minimal CPU, GPU, memory, and battery consumption is the primary requirement. Every line of code and CSS selector must respect this constraint.
- **Zero-Dependency Extension Core**: The extension runs pure, vanilla WebExtensions code (plain JavaScript and CSS) loaded directly by Chromium's V8/Blink engine. No bundlers or frameworks in the extension payload.
- **Distraction-Free**: Eliminates recommendation algorithms, ambient lighting effects, promotional widgets, and automated description shelves.

## 2. Technical Stack & Tooling

- **Extension Runtime**: Vanilla JavaScript (ES2022+), CSS3, Chrome Extensions MV3 (`declarativeNetRequest`, content scripts, background service worker).
- **Extension Payload**: Zero dependencies. Nothing under `test/` or `bench/` is shipped — only the files listed in `manifest.json` plus the icons.
- **Development Tooling & Testing**: **Bun** is the designated runtime and package runner (`bun run`, `bun test`). Dev-only dependencies belong in `devDependencies` and must never be imported by the extension files.
- **Release Automation**: Release Please (`release-please-config.json`, `.release-please-manifest.json`).

### Commands

| Command | Purpose |
| --- | --- |
| `bun test` | Fast unit suite (DOM shim + fixtures, no browser). |
| `bun run test:blink` | Differential selector test: shim vs. real Blink. |
| `bun run verify:dom [url]` | Live YouTube DOM check: anchors exist, every selector parses. |
| `bun run verify:css [url]` | Live behavioral check: computed styles and layout promises hold. |
| `bun run verify` | All four gates in sequence. Run before merging. |
| `bun run bench` | Reproducible baseline-vs-extension benchmark in headless Chrome. |
| `bun run bench:update` | Same, and writes `bench/results.json`. |

### Test Harness Map

- `test/dom.js` — Minimal DOM/localStorage/timer/MutationObserver shim that runs the **unmodified** content scripts under `node:vm`. Models listener phases (capture/bubble), `once`, and `stopPropagation`. Only implements the surface the extension uses.
- `test/fixture.js` — Builds a YouTube-shaped DOM (`ytd-watch-flexy`, `#primary`/`#secondary`/`#below`, comment renderers, player controls, engagement panels, live chat).
- `test/background.test.js` — Injects a fake `chrome` global and runs the real service worker under `node:vm`.
- `bench/blink-parity.js` — Differential test that builds the same markup in the shim and in real Blink and asserts identical selector results. It lives in `bench/` because `bun test` must never launch a browser; `test/static.test.js` enforces that.
- `bench/verify-dom.js` vs `bench/verify-css.js` — Validity versus behavior. `verify:dom` proves selectors still parse and their anchors still exist, which is **not** enough: renaming a selector to a class that never matches keeps it 100% "valid" while the feature silently stops working. `verify:css` asserts computed `display`, the player clamp, and document order, which is what catches that class of regression.
- `bench/browser.js`, `bench/cdp.js` — Zero-dependency Chrome DevTools Protocol driver (Bun's global `WebSocket`).

### Changing the DOM shim

If you touch `test/dom.js`, extend `bench/blink-parity.js` with the new selector shape so shim/Blink parity stays enforced.

### Assertions Must Be Able to Fail

- Never wrap an assertion in `if`: `if (el) expect(...)` passes precisely when the element is missing, which is usually the bug.
- Prefer asserting a stable contract (computed style, document order, storage key, call arguments) over a proxy such as a raw pixel measurement. `#primary` clamps width on its own, so a removed player clamp is invisible to `getBoundingClientRect`.
- When a check cannot fail on the current page, drive the state instead of accepting absence: inject a probe element for `.ytp-ambient-canvas`, or toggle `ytlite-sidebar-active` to exercise the reveal rule.
- `verify:css` guards its own harness: `test/static.test.js` checks that `bun test` stays browser-free.

### World Boundaries

- `comments.js` and `start.js` run in the **ISOLATED** world. YouTube's `ytd-*` custom-element prototype methods and the `#movie_player` playback API are page-JS expandos and are **undefined** there. Never call them from these files.
- `player.js` runs in the **MAIN** world and is the only place those APIs exist. It publishes live status on `<html>` as `data-ytlite-live` / `data-ytlite-video` and listens for the `ytlite-set-quality` and `ytlite-open-chat` events the isolated world dispatches.
- Playback quality is modified only while Audio-only is on. With it off, `player.js` restores the user's prior level and otherwise does nothing.

## 3. Critical Performance Guardrails

Follow these rules on every edit to prevent performance degradation:

- **No CSS `:has(...)` selectors**: Do not use `:has(...)` on watch layouts or repeated elements. In Blink, `:has(...)` invalidates style caches and triggers cascades of expensive style recalculations on every DOM mutation. Use specific class names or attribute selectors instead.
- **No Unscoped MutationObservers**: Never observe `document.body` or `#content` with `{ childList: true, subtree: true }`. Target the narrowest possible parent node, and disconnect observers immediately once the target node is found or handled.
- **No Continuous Polling**: Never use `setInterval` or recursive timeouts to wait for DOM elements. Hook into YouTube lifecycle events (`yt-navigate-finish`, `yt-page-data-updated`) or single-shot observers.
- **No Ambient/GPU Effects**: Keep canvas ambient lighting, CSS blur, backdrop filters, box shadows, and transitions disabled on YouTube chrome elements.

## 4. UI & Layout Specifications

- **Player Layout**: Clamped to a compact standard size (max-width `854px`, max-height `480px`, aspect ratio `16:9`) and centered horizontally on watch pages.
- **Sidebar (`#secondary`)**: Hidden by default for regular videos. Revealed only when it has content to show: an open live chat frame (`html.ytlite-live` plus `html.ytlite-sidebar-active`) or an active engagement panel (`html.ytlite-sidebar-active`). A live video with no chat must not reserve the column.
- **Comments**: Collapsed by default (`html.ytlite-comments-hide`). Rendered on demand via `.ytlite-comments-btn`.
- **Description Box**: Creator text is preserved; automated clutter (Ask AI, music/gaming infocards, transcripts, channel subscriber/social headers) is hidden.

## 5. Git & Workflow Standards

- **Commit Messages**: Follow Conventional Commits format (`feat:`, `fix:`, `perf:`, `chore:`, `docs:`). Do not include conversational remarks, agent commentary, or reference to user prompts in commit messages.
- **Verification**: Run `bun run verify` before merging. It covers the unit suite, shim/Blink selector parity, live selector validity, and live CSS/layout behavior. Use a `/live` URL when touching chat or panel logic.
- **Observers**: Creating an observer and then returning before `observe()` is a leak. Assign `observer = new MutationObserver(...)` only immediately before `observe()`, and always arm a safety timeout. `test/comments.test.js` guards this.
