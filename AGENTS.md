# AGENTS.md — YT Lite Project Guidelines

YT Lite is a zero-dependency, low-overhead Chrome extension (MV3) built in vanilla JS/CSS to keep YouTube lightweight on low-spec laptops.

## 1. Core Principles & Stack

- **Zero-Dependency Extension Core**: Extension runtime scripts (`manifest.json`) must stay vanilla JS/CSS with zero build step or npm imports (`devDependencies` are for `test/` and `bench/` tooling only).
- **Commands**: Defined in [`package.json`](package.json) (`bun test`, `bun run test:blink`, `bun run verify:dom [url]`, `bun run verify:css [url]`, `bun run verify`, `bun run bench`, `bun fmt`).
- **Pre-merge Gate**: Run `bun run verify` before merging; pass a `/live` URL when modifying live-chat, replay, or sidebar panel logic.

## 2. World Boundaries & Bridge

- **ISOLATED world** (`start.js`, `comments.js`): Owns layout classes, reveal UI, and `#secondary` coordination. Never access `ytd-*` prototype methods or `#movie_player` playback APIs here.
- **MAIN world** (`player.js`): Owns player APIs and custom-element prototypes. Publishes `<html>` attributes and communicates via `localStorage` and window events documented in [`docs/adr/0001-dual-world-content-script-bridge.md`](docs/adr/0001-dual-world-content-script-bridge.md).
- **Audio-Only Mode**: Modify playback quality only while Audio-only is enabled; restore the prior level once when turned off (`docs/adr/0002-zero-stall-audio-only-video-suppression.md`).

## 3. Performance & Guardrails

- [`test/static.test.js`](test/static.test.js) and [`test/comments.test.js`](test/comments.test.js) enforce CSS `:has(...)` bans, observer target/leak/timeout rules, polling bans, GPU chrome effect bans, world isolation, and browser-free unit runs.
- Keep fallback `MutationObserver`s scoped to `ytd-app` or narrower watch containers—never `document.body` (`subtree: false`) or `#primary-inner` (`subtree: true`).
- When modifying the DOM shim in [`test/dom.js`](test/dom.js), add matching selector checks to [`bench/blink-parity.js`](bench/blink-parity.js).
- Reviewers: also enforce [`CODING_STANDARDS.md`](CODING_STANDARDS.md).

## 4. UI & Layout Contracts

- **Player Layout**: Clamped to `max-width: 854px`, `max-height: 480px`, `aspect-ratio: 16:9`, centered on Watch Pages.
- **Sidebar (`#secondary`)**: Hidden on Regular Videos and Stream Replays unless an Engagement Panel is open (`html.ytlite-sidebar-active`); revealed on active Live Streams only when Live Chat is open (`html.ytlite-live` + `html.ytlite-sidebar-active`).
- **Comments & Reveal UI**: Collapsed behind `.ytlite-comments-btn` (`html.ytlite-comments-hide`) on Regular Videos and Stream Replays; reveal buttons mount in primary column metadata areas, never inside hidden `#secondary #panels`.
- **Description Box**: Preserve creator text; hide automated clutter (Ask AI, infocards, transcripts, channel/social headers).

## 5. Git & Agent Docs

- **Hooks**: `.githooks/` enforces `bun fmt`, `bun run test`, and Conventional Commits (`feat:`, `fix:`, `perf:`, `chore:`, `docs:`, `test:`, `refactor:`) without prompt/agent chatter.
- **Issue tracker & labels**: [`docs/agents/issue-tracker.md`](docs/agents/issue-tracker.md), [`docs/agents/triage-labels.md`](docs/agents/triage-labels.md).
- **Domain glossary & ADRs**: [`GLOSSARY.md`](GLOSSARY.md), [`docs/adr/`](docs/adr/), usage guide in [`docs/agents/domain.md`](docs/agents/domain.md).
