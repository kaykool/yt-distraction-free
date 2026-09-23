#!/usr/bin/env bun
// Reproducible benchmark for the extension's performance claims.
//
// Compares a real YouTube watch page rendered in headless Chrome with and without
// the unpacked extension, measuring:
//   - DOM node count
//   - Blink layout-tree node count  (the "-X% render tree" claim)
//   - forced style/layout recalculation time
//   - total layout + style recalc durations over page lifetime (Blink metrics)
//
// Usage: bun run bench          -> print a table
//        bun run bench:update   -> also write bench/results.json
import fs from 'node:fs';
import path from 'node:path';
import { launchPage, captureLayoutStats, measureForcedReflow } from './browser.js';

const EXT_DIR = path.resolve(import.meta.dir, '..');
const TMP = path.join(EXT_DIR, '.bench-tmp');
const URL = process.env.BENCH_URL || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS || 9000);
const RUNS = Number(process.env.BENCH_RUNS || 3);
const WRITE = process.argv.includes('--write');

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

async function measureOnce({ port, withExtension, run }) {
  const profileDir = path.join(TMP, `${withExtension ? 'ext' : 'base'}-${run}`);
  fs.rmSync(profileDir, { recursive: true, force: true });

  const page = await launchPage({ port, extensionDir: withExtension ? EXT_DIR : null, profileDir });
  try {
    await page.goto(URL);
    // Wait for the watch page to fully hydrate.
    await page.evaluate(`new Promise((resolve) => {
      const ready = () => document.querySelector('ytd-watch-flexy, ytd-watch-grid') &&
        document.querySelector('#secondary') && document.querySelector('#below');
      if (ready()) return resolve(true);
      const obs = new MutationObserver(() => { if (ready()) { obs.disconnect(); resolve(true); } });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(false); }, ${SETTLE_MS});
    })`);
    await Bun.sleep(1500);

    const stats = await captureLayoutStats(page.send, page.evaluate);
    const reflowMs = await measureForcedReflow(page.evaluate, 30);
    const classes = await page.evaluate('[...document.documentElement.classList]');
    const button = await page.evaluate("!!document.querySelector('.ytlite-button-container')");
    return { ...stats, reflowMs, classes, button };
  } finally {
    await page.close();
  }
}

async function measure(label, opts) {
  const samples = [];
  for (let run = 1; run <= RUNS; run++) {
    // YouTube navigations can occasionally invalidate the inspected target; retry
    // a run instead of aborting the whole benchmark.
    let s = null;
    for (let attempt = 1; attempt <= 3 && !s; attempt++) {
      try {
        s = await measureOnce({ ...opts, run });
      } catch (err) {
        process.stdout.write(`  ${label} run ${run} attempt ${attempt} failed: ${err.message}\n`);
        if (attempt === 3) throw err;
        await Bun.sleep(2000);
      }
    }
    samples.push(s);
    process.stdout.write(`  ${label} run ${run}/${RUNS}: layoutNodes=${s.layoutNodes} dom=${s.domNodes}\n`);
  }
  const out = {};
  for (const key of Object.keys(samples[0])) {
    if (typeof samples[0][key] === 'number') out[key] = median(samples.map((s) => s[key]));
    else out[key] = samples[0][key];
  }
  return out;
}

function pct(from, to) {
  if (!from) return '0.0%';
  return `${(((from - to) / from) * 100).toFixed(1)}%`;
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  console.log(`Benchmarking ${URL}\nRuns: ${RUNS}, settle: ${SETTLE_MS}ms\n`);

  const base = await measure('baseline ', { port: 9601, withExtension: false });
  const ext = await measure('extension', { port: 9602, withExtension: true });

  const rows = [
    ['DOM nodes', base.domNodes, ext.domNodes, pct(base.domNodes, ext.domNodes)],
    ['Layout-tree nodes', base.layoutNodes, ext.layoutNodes, pct(base.layoutNodes, ext.layoutNodes)],
    ['Forced reflow (ms)', base.reflowMs, ext.reflowMs, pct(base.reflowMs, ext.reflowMs)],
    ['Layout count', base.layoutCount, ext.layoutCount, pct(base.layoutCount, ext.layoutCount)],
    ['Style recalcs', base.recalcStyleCount, ext.recalcStyleCount, pct(base.recalcStyleCount, ext.recalcStyleCount)],
    ['Layout duration (ms)', (base.layoutDuration * 1000), (ext.layoutDuration * 1000), pct(base.layoutDuration, ext.layoutDuration)],
    ['Style duration (ms)', (base.recalcStyleDuration * 1000), (ext.recalcStyleDuration * 1000), pct(base.recalcStyleDuration, ext.recalcStyleDuration)],
    ['JS heap (MB)', base.jsHeapUsed / 1048576, ext.jsHeapUsed / 1048576, pct(base.jsHeapUsed, ext.jsHeapUsed)],
  ];

  const pad = (s, n) => String(s).padEnd(n);
  const num = (n) => (typeof n === 'number' ? n.toFixed(1) : String(n));
  console.log(`\n${pad('metric', 22)}${pad('baseline', 12)}${pad('extension', 12)}reduction`);
  console.log('-'.repeat(58));
  for (const [name, b, e, p] of rows) console.log(`${pad(name, 22)}${pad(num(b), 12)}${pad(num(e), 12)}${p}`);

  const result = {
    url: URL,
    runs: RUNS,
    settleMs: SETTLE_MS,
    timestamp: new Date().toISOString(),
    baseline: base,
    extension: ext,
    reduction: {
      domNodes: pct(base.domNodes, ext.domNodes),
      layoutNodes: pct(base.layoutNodes, ext.layoutNodes),
      forcedReflow: pct(base.reflowMs, ext.reflowMs),
      layoutCount: pct(base.layoutCount, ext.layoutCount),
      recalcStyleCount: pct(base.recalcStyleCount, ext.recalcStyleCount),
      layoutDuration: pct(base.layoutDuration, ext.layoutDuration),
      recalcStyleDuration: pct(base.recalcStyleDuration, ext.recalcStyleDuration),
      jsHeap: pct(base.jsHeapUsed, ext.jsHeapUsed),
    },
  };

  if (WRITE) {
    const outFile = path.join(EXT_DIR, 'bench', 'results.json');
    fs.writeFileSync(outFile, JSON.stringify(result, null, 2) + '\n');
    console.log(`\nWrote ${path.relative(EXT_DIR, outFile)}`);
  }
  fs.rmSync(TMP, { recursive: true, force: true });
}

main().catch((err) => { console.error(err); process.exit(1); });
