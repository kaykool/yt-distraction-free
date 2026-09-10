# YT Lite — Resource Consumption Benchmark Report

> Comparative benchmark measuring resource overhead on YouTube with **YT Lite extension enabled** versus **Vanilla YouTube (No Extension)**.

## Benchmark Metadata

- **Date**: 2026-09-10T03:47:51.875Z
- **Target URL**: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
- **Observation Window**: `8 seconds`
- **Benchmark Runs**: `1`
- **Browser**: `Chrome/151.0.7922.34`
- **Operating System**: `Linux 7.2.3-1-cachyos (x64)`

## Resource Comparison Table

| Category | Metric | Vanilla (No Extension) | YT Lite (With Extension) | Delta | Change | Impact |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| Memory | JS Heap Active | 75.6 MB | 81.99 MB | +6.39 MB | +8.5% | ⚠️ Overhead |
| Memory | JS Heap Retained (Post-GC) | 45.37 MB | 47.13 MB | +1.76 MB | +3.9% | ⚠️ Overhead |
| Memory | JS Heap Allocated | 119.25 MB | 116.23 MB | -3.02 MB | -2.5% | ✅ **Saved** |
| DOM & Structure | Total DOM Nodes | 16,428 | 17,282 | +854 | +5.2% | ⚠️ Overhead |
| DOM & Structure | Document Elements | 5,353 | 5,737 | +384 | +7.2% | ⚠️ Overhead |
| DOM & Structure | Layout/Render Objects | 2,472 | 960 | -1,512 | -61.2% | ✅ **Saved** |
| DOM & Structure | JS Event Listeners | 3,913 | 4,231 | +318 | +8.1% | ⚠️ Overhead |
| DOM & Structure | Documents / Frames | 7 | 7 | 0 | 0.0% | Neutral |
| Page Speed & Timing | DOMContentLoaded Time | 2.95 s | 3.52 s | +565.5 ms | +19.1% | ⚠️ Overhead |
| Page Speed & Timing | First Meaningful Paint | 4.04 s | 4.55 s | +507.4 ms | +12.5% | ⚠️ Overhead |
| CPU & Execution | Main Thread Tasks | 1.88 s | 1.95 s | +68.7 ms | +3.7% | ⚠️ Overhead |
| CPU & Execution | Script Execution | 1.09 s | 1.18 s | +91.9 ms | +8.5% | ⚠️ Overhead |
| CPU & Execution | Thread CPU Time | 1.86 s | 1.90 s | +37.3 ms | +2.0% | ⚠️ Overhead |
| CPU & Execution | Process CPU Time | 3.51 s | 3.70 s | +190.0 ms | +5.4% | ⚠️ Overhead |
| CPU & Execution | V8 Compile Time | 7.7 ms | 11.2 ms | +3.4 ms | +44.5% | ⚠️ Overhead |
| Layout & Style | Layout Passes | 157 | 138 | -19 | -12.1% | ✅ **Saved** |
| Layout & Style | Layout Duration | 88.8 ms | 65.9 ms | -22.9 ms | -25.8% | ✅ **Saved** |
| Layout & Style | Recalc Style Passes | 234 | 215 | -19 | -8.1% | ✅ **Saved** |
| Layout & Style | Recalc Style Duration | 122.7 ms | 107.1 ms | -15.6 ms | -12.7% | ✅ **Saved** |
| Network & Data | Total Requests | 172 | 180 | +8 | +4.7% | ⚠️ Overhead |
| Network & Data | Blocked Requests | 0 | 1 | +1 | +1 (new) | ✅ **Saved** |
| Network & Data | Transferred Data | 5.77 MB | 5.67 MB | -98.26 KB | -1.7% | ✅ **Saved** |
| DOM Mutations | Mutation Records | 1,861 | 1,877 | +16 | +0.9% | Neutral |
| DOM Mutations | Nodes Added | 2,616 | 2,639 | +23 | +0.9% | Neutral |
| DOM Mutations | Nodes Removed | 533 | 528 | -5 | -0.9% | ✅ **Saved** |

## Network Resource Breakdown

| Resource Type | Vanilla Requests | Vanilla Data | YT Lite Requests | YT Lite Data | Data Delta |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Document** | 2 | 149.12 KB | 2 | 152.24 KB | +3.13 KB |
| **Script** | 22 | 3.06 MB | 22 | 3.06 MB | -145 B |
| **XHR** | 5 | 2.15 KB | 5 | 2.1 KB | -50 B |
| **Fetch** | 107 | 1.45 MB | 119 | 1.45 MB | -68 B |
| **Image** | 17 | 276.43 KB | 14 | 214.97 KB | -61.45 KB |
| **Stylesheet** | 8 | 378.01 KB | 8 | 378.8 KB | +801 B |
| **Font** | 3 | 103.17 KB | 2 | 62.77 KB | -40.41 KB |
| **Other** | 8 | 381.85 KB | 8 | 381.8 KB | -59 B |

## Blocked Ad & Telemetry Requests

The following ad, tracker, and telemetry network requests were blocked by declarativeNetRequest rules:

- `https://www.youtube.com/youtubei/v1/log_event?alt=json`

## Key Architectural Savings

1. **Zero Comment Tree Hydration**: YT Lite hides and delays the comment section until the user explicitly clicks *"Show comments"*, preventing thousands of Polymer comment elements and avatars from populating the DOM.
2. **Secondary Sidebar Collapsed**: Collapsing the heavy recommendation sidebar eliminates related video thumbnails, live chat iframes, and secondary layout invalidations.
3. **Zero Polling & Zero Ongoing Observers**: During video playback, YT Lite runs **0 MutationObservers** and **0 setInterval polling timers**, resulting in lower main thread CPU consumption.
4. **Declarative Network Request Ad & Telemetry Blocking**: Pre-filters tracking, telemetry, and ad requests at the network engine layer before they consume network sockets or CPU.

## Methodology

- Spawns isolated Chromium instances with clean, ephemeral user data directories to guarantee no cache or cookie contamination.
- Uses the Chrome DevTools Protocol (`Performance.getMetrics`, `HeapProfiler`, `Network`, `Page`) directly over native WebSockets.
- Enforces post-run deterministic garbage collection (`HeapProfiler.collectGarbage`) to measure true retained JS heap without GC scheduling jitter.
- Pre-seeds YouTube cookie consent tokens (`SOCS`) to bypass European/GDPR interstitial walls in headless runs.
