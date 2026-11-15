# Coding Standards (Review Guide)

Judgement-call standards for `/code-review`. Deterministic syntax/CSS/observer bans live in `test/static.test.js` and `test/comments.test.js`; formatting and Conventional Commits are enforced by `.githooks/`.

## State & Signal Precedence

- Rank Watch Page classification signals explicitly: navigation `playerResponse` > `MAIN`-world player flags (`data-ytlite-live`, `data-ytlite-replay`) > unflagged `conversationBar` or DOM cues.
- Never commit `definitive = true` cache entries from provisional signals (`yt-page-data-updated` omitting `playerResponse`, unflagged `liveChatRenderer`, or DOM chat-stamp attributes).
- Never allow stale DOM children without a matching `video-id` to override active URL state during SPA transitions.

## Data Modeling & Clarity

- Pass explicit options objects or nullable identifiers (`{ watch, isLive, syncQuality }`, `replayVideoId`) instead of overloading booleans and sentinel strings (`init(true)` vs options, `replayId || 'true'`).
- Remove obsolete fields from event and signal payloads across both producer and consumer paths when refactoring.

## Cohesion & Module Boundaries

- Extract shared helpers when parallel handlers (`yt-navigate-finish` / `yt-page-data-updated`, engagement panel / `yt-action` listeners) run the same signal parsing or scheduling steps.
- Split large `ISOLATED`-world concerns into focused scripts loaded via `manifest.json` rather than accumulating unrelated responsibilities in a single 500+ line file.

## Test & Verification Integrity

- Every test or live check assertion must be able to fail: avoid `if (el) expect(...)`, `!hasApi || ...`, or silent `{ ok: true }` escape hatches when a required control or expandos API is absent.
- Bounded timeouts: wrap async browser probes (`video.play()`, CDP evaluations) with explicit timeout races and emit failing element/media state on error.
