# YT Distraction Free (YT Lite)

A lightweight, distraction-free Manifest V3 Chrome extension designed to declutter YouTube, block advertising and telemetry, prevent automatic comment loading, and cut layout/GPU overhead during video playback.

https://github.com/user-attachments/assets/ab971807-9386-4fc2-b8d0-df88d511e108

---

## Why I Built This

I just wanted to watch YouTube on my potato laptop without it lagging and sounding like a jet engine.

YouTube today is heavy. It runs ambient lighting effects behind the player, preloads dozens of sidebar video previews you never asked for, and dumps thousands of comments into memory before you even scroll down.

This extension cuts all of that out. No sidebar distractions, no ambient glow, and comments only load if you actually click the button. Videos play smoothly, and my potato laptop is finally happy.

---

## Features

- **On-Demand Comments**: Comments are completely suppressed until you explicitly click **"Show comments"**. No background continuation requests (`youtubei/v1/next`) or avatars are loaded until requested.
- **Block Video (Audio-Only Mode)**: Toggle button in the player control overlay beside Autoplay blanks video display while audio keeps playing, cutting GPU frame compositing and decoding overhead. State is remembered across videos. While audio-only is **off**, the extension never touches playback quality — your own quality selection is left exactly as YouTube set it.
- **Distraction-Free Centered Layout**: Suppresses the right-hand sidebar recommendation column, in-feed suggested videos, and thumbnail hover-prefetches, keeping the player cleanly centered.
- **Smart Sidebar Adaptation**: The sidebar dynamically appears only when it has something to show — **Live Chat**, YouTube's **Ask (AI conversational panel)**, transcripts or chapters — and collapses back when closed.
- **Ultra-Low Playback Overhead**:
  - **Zero ongoing observers**: The `MutationObserver` disconnects immediately once the button is mounted (0 running observers, 0 timers, 0 intervals during playback).
  - **Zero GPU Ambient Glow**: Disables `.ytp-ambient-canvas`, saving laptop battery and GPU shader execution.
  - **~62% Render Tree Reduction**: Eliminates roughly 1,350 layout boxes from Blink's layout tree and cuts forced style/layout recalculation time by ~54% (measured, reproducible — see [Benchmarks](#benchmarks)).
- **Pure C++ Ad & Telemetry Blocking**: Uses Chrome's native Declarative Net Request (DNR) API to block third-party trackers (DoubleClick, Google Analytics, AdServices) and YouTube telemetry (`log_event`, `feedback`) with **0 JavaScript runtime cost**. Every rule is scoped to `www.youtube.com`, so neither this extension nor its blocking applies to any other site, including `music.youtube.com` and `m.youtube.com`.
- **Long Video Focused**: YouTube Shorts remain in their native interface with default controls and comments.

---

## Installation

1. Clone or download this repository:
   ```bash
   git clone https://github.com/kaykool/yt-distraction-free.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** in the top-left corner.
5. Select the `yt-distraction-free` directory.

---

## Project Structure

```
yt-distraction-free/
├── manifest.json   # MV3 configuration & DNR ruleset definition
├── rules.json      # DeclarativeNetRequest ad & telemetry blocking rules (YouTube-scoped)
├── start.js        # Early document_start script (prevents comment flash)
├── player.js       # MAIN world: Audio-only quality, live flag, live-chat control
├── comments.js     # Watch-page lifecycle & on-demand comment reveal button
├── hide.css        # Clean centered layout, ambient canvas & ad suppression
├── background.js   # One-time cleanup for legacy dynamic DNR rules
├── icons/          # Extension icons (16px, 32px, 48px, 128px)
├── test/           # Bun unit tests + DOM shim (dev only, not shipped)
├── bench/          # Benchmark, Blink parity & live DOM/CSS verifiers (dev only)
├── README.md       # Project documentation
└── LICENSE         # MIT License
```

The `test/` and `bench/` directories are development tooling and are **not** part of the
installed extension. Nothing outside `manifest.json` + `icons/` is loaded at runtime.

---

## Development

Dev tooling uses [Bun](https://bun.sh) and a local Chrome/Chromium. There are **no
runtime dependencies** — the extension itself stays pure vanilla JS/CSS.

```bash
bun install          # no-op today; dev tools are dependency-free
bun test             # unit suite (fast, no browser)
bun run test:blink   # differential shim-vs-Blink selector parity (launches Chrome)
bun run verify:dom   # every selector still parses and its anchor still exists
bun run verify:css   # computed styles and layout promises actually hold
bun run verify       # all of the above, in sequence
bun run bench        # baseline vs. extension benchmark in headless Chrome
bun run bench:update # same, and refresh bench/results.json
```

- `test/` runs the unmodified content scripts against a small DOM shim, so the
  default suite needs no browser and finishes in well under a second.
- `bench/blink-parity.js` is a differential test: it builds identical markup in the
  shim and in real Blink and asserts both engines resolve the extension's selectors
  the same way. It launches Chrome, so it is a separate script rather than part of
  `bun test`.
- `verify:dom` and `verify:css` are different checks. `verify:dom` asks whether the
  selectors are still *valid* and their anchor elements still exist. `verify:css`
  asks whether the rules still *do* anything: computed `display`, the player clamp,
  and document order. A selector silently renamed to a class that never matches
  passes the first and fails the second, which is why both exist. Run both (plus a
  `/live` URL when touching chat or panel logic) before committing a selector change.

## Benchmarks

`bench/results.json` is generated by `bun run bench:update`. It compares a real
YouTube watch page rendered in headless Chrome **with and without** the unpacked
extension, using Chromium's own metrics — no hand-waving. Latest run
(`bun run bench:update`, 3 runs, medians):

| Metric | Baseline | Extension | Change |
| --- | --- | --- | --- |
| Layout-tree nodes | 2177 | 818 | **-62.4%** |
| Forced reflow (ms) | 1.40 | 0.64 | **-54.4%** |
| Layout duration (ms) | 141.1 | 105.9 | -24.9% |
| Style recalc duration (ms) | 234.8 | 162.6 | -30.7% |
| Layout count | 159 | 134 | -15.7% |
| Style recalcs | 236 | 216 | -8.5% |
| DOM nodes | 5171 | 5617 | +8.6% |

Both the layout-tree reduction and the reflow reduction are the point: the
extension removes **layout boxes**, not DOM nodes (its own button adds a few), which
is what cuts style/layout work during playback. Numbers vary with YouTube build,
video, and machine — reproduce them locally rather than trusting the table:

```bash
bun run bench:update
```

Set `BENCH_RUNS`, `BENCH_SETTLE_MS`, `BENCH_URL`, or `CHROME_BIN` to adjust.

## License

MIT License. See [LICENSE](LICENSE) for details.
