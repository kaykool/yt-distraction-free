# YT Distraction Free (YT Lite)

A lightweight, distraction-free Manifest V3 Chrome extension designed to declutter YouTube, block advertising and telemetry, prevent automatic comment loading, and cut layout/GPU overhead during video playback.

---

## Why I Built This

I wanted to watch YouTube on a potato laptop without it stuttering and spinning fans like a jet engine. Modern YouTube burns huge resources on ambient canvas glows, dozens of sidebar thumbnail prefetches, and thousands of unread comment DOM nodes.

This extension strips the bloat: it kills ambient lighting, collapses sidebar recommendations, blocks telemetry via C++ network rules, and loads comments strictly on demand—cutting the render tree by **over 60%** and reducing layout CPU time by ~26%. My potato laptop is now happy.

---

## Features

- **On-Demand Comments**: Comments are completely suppressed until you explicitly click **"Show comments"**. No background continuation requests (`youtubei/v1/next`) or avatars are loaded until requested.
- **Distraction-Free Centered Layout**: Suppresses the right-hand sidebar recommendation column, in-feed suggested videos, and thumbnail hover-prefetches, keeping the player cleanly centered.
- **Smart Sidebar Adaptation**: The sidebar dynamically appears when **Live Chat** or YouTube's **Ask (AI conversational panel)** / transcripts / chapters are active, and collapses back when closed.
- **Ultra-Low Playback Overhead**:
  - **Zero ongoing observers**: The `MutationObserver` disconnects immediately once the button is mounted (0 running observers, 0 timers, 0 intervals during playback).
  - **Zero GPU Ambient Glow**: Disables `.ytp-ambient-canvas`, saving laptop battery and GPU shader execution.
  - **-61% Render Tree Reduction**: Eliminates over 1,500 layout boxes from Blink's render tree, cutting style and layout recalculation time by ~26%.
- **Pure C++ Ad & Telemetry Blocking**: Uses Chrome's native Declarative Net Request (DNR) API to block third-party trackers (DoubleClick, Google Analytics, AdServices) and YouTube telemetry (`log_event`, `feedback`) with **0 JavaScript runtime cost**.
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
├── rules.json      # DeclarativeNetRequest ad & telemetry blocking rules
├── start.js        # Early document_start script (prevents comment flash)
├── comments.js     # Watch-page lifecycle & on-demand comment reveal button
├── hide.css        # Clean centered layout, ambient canvas & ad suppression
├── background.js   # One-time cleanup for legacy dynamic DNR rules
├── README.md       # Project documentation
└── LICENSE         # MIT License
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
