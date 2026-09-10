# AGENTS.md — YT Lite Project Guidelines

YT Lite is a high-performance, distraction-free Chrome extension (MV3) built to run YouTube smoothly on resource-constrained laptops.

## 1. Core Principles

- **Ultra-Low Overhead**: Minimal CPU, GPU, memory, and battery consumption is the primary requirement. Every line of code and CSS selector must respect this constraint.
- **Zero-Dependency Extension Core**: The extension runs pure, vanilla WebExtensions code (plain JavaScript and CSS) loaded directly by Chromium's V8/Blink engine. No bundlers or frameworks in the extension payload.
- **Distraction-Free**: Eliminates recommendation algorithms, ambient lighting effects, promotional widgets, and automated description shelves.

## 2. Technical Stack & Tooling

- **Extension Runtime**: Vanilla JavaScript (ES2022+), CSS3, Chrome Extensions MV3 (`declarativeNetRequest`, content scripts, background service worker).
- **Development Tooling & Testing**: **Bun** is the designated runtime and package runner for all dev tools, test suites, and benchmark scripts (`bun run`, `bun test`).
- **Release Automation**: Release Please (`release-please-config.json`, `.release-please-manifest.json`).

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
- **Verification**: Always verify selector accuracy against actual YouTube WebComponent DOM structures before committing.
