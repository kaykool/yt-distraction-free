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
| `bun test test/dom.test.js` | Differential selector test: shim vs. real Blink. |
| `bun run bench` | Reproducible baseline-vs-extension benchmark in headless Chrome. |
| `bun run bench:update` | Same, and writes `bench/results.json`. |
| `bun run verify:dom [url]` | Checks the extension against the **live** YouTube DOM. |
| `bun run verify:dom "https://www.youtube.com/live/..."` | Same, for a live stream (exercises chat/panel selectors). |

### Test Harness Map

- `test/dom.js` — Minimal DOM/localStorage/timer/MutationObserver shim that runs the **unmodified** content scripts under `node:vm`. Only implements the surface the extension uses.
- `test/fixture.js` — Builds a YouTube-shaped DOM (`ytd-watch-flexy`, `#primary`/`#secondary`/`#below`, comment renderers, player controls, engagement panels, live chat).
- `test/dom.test.js` — Differential test that builds the same markup in the shim and in real Blink and asserts identical selector results.
- `bench/browser.js`, `bench/cdp.js` — Zero-dependency Chrome DevTools Protocol driver (Bun's global `WebSocket`).

### Changing the DOM shim

If you touch `test/dom.js`, extend `test/dom.test.js` with the new selector shape so shim/Blink parity stays enforced.

## 3. Critical Performance Guardrails

Follow these rules on every edit to prevent performance degradation:

- **No CSS `:has(...)` selectors**: Do not use `:has(...)` on watch layouts or repeated elements. In Blink, `:has(...)` invalidates style caches and triggers cascades of expensive style recalculations on every DOM mutation. Use specific class names or attribute selectors instead.
- **No Unscoped MutationObservers**: Never observe `document.body` or `#content` with `{ childList: true, subtree: true }`. Target the narrowest possible parent node, and disconnect observers immediately once the target node is found or handled.
- **No Continuous Polling**: Never use `setInterval` or recursive timeouts to wait for DOM elements. Hook into YouTube lifecycle events (`yt-navigate-finish`, `yt-page-data-updated`) or single-shot observers.
- **No Ambient/GPU Effects**: Keep canvas ambient lighting, CSS blur, backdrop filters, box shadows, and transitions disabled on YouTube chrome elements.

## 4. UI & Layout Specifications

- **Player Layout**: Clamped to a compact standard size (max-width `854px`, max-height `480px`, aspect ratio `16:9`) and centered horizontally on watch pages.
- **Sidebar (`#secondary`)**: Hidden by default for regular videos. Dynamically revealed when live stream chat (`html.ytlite-live`) or active engagement panels (`html.ytlite-sidebar-active`) are present.
- **Comments**: Collapsed by default (`html.ytlite-comments-hide`). Rendered on demand via `.ytlite-comments-btn`.
- **Description Box**: Creator text is preserved; automated clutter (Ask AI, music/gaming infocards, transcripts, channel subscriber/social headers) is hidden.

## 5. Git & Workflow Standards

- **Commit Messages**: Follow Conventional Commits format (`feat:`, `fix:`, `perf:`, `chore:`, `docs:`). Do not include conversational remarks, agent commentary, or reference to user prompts in commit messages.
- **Verification**: Always verify selector accuracy against actual YouTube WebComponent DOM structures before committing. Run `bun test` plus `bun run verify:dom` (and a `/live` URL when touching chat/panel logic) before merging.
- **Observers**: Creating an observer and then returning before `observe()` is a leak. Assign `observer = new MutationObserver(...)` only immediately before `observe()`, and always arm a safety timeout. `test/comments.test.js` guards this.
