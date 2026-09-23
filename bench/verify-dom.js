#!/usr/bin/env bun
// Verifies the extension against the real, live YouTube DOM before committing a
// selector change (AGENTS.md §5).
//
// Two independent checks:
//   1. STRUCTURE  - the anchor element(s) the extension needs actually exist.
//   2. VALIDITY   - every selector in hide.css / the scripts still parses in Blink
//                   (catches typo'd or removed-syntax selectors).
// Selectors that only apply to other states (fullscreen, /live, watch-grid variant,
// dialogs, shelves absent from a given video) are informational, not failures.
//
// Usage: bun run verify:dom [url]
import fs from 'node:fs';
import path from 'node:path';
import { launchPage } from './browser.js';

const EXT_DIR = path.resolve(import.meta.dir, '..');
const URL = process.argv[2] || process.env.VERIFY_URL || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS || 9000);

// Anchors the extension's logic depends on for a normal watch page.
// `anyOf` groups express "YouTube may serve either flavour of this element".
const REQUIRED = [
  { name: 'watch container',     anyOf: ['ytd-watch-flexy', 'ytd-watch-grid'] },
  { name: 'primary column',      anyOf: ['#primary'] },
  { name: 'primary-inner',       anyOf: ['#primary-inner'] },
  { name: 'below fold',          anyOf: ['#below'] },
  { name: 'secondary column',    anyOf: ['#secondary'] },
  { name: 'watch metadata',      anyOf: ['ytd-watch-metadata'] },
  { name: 'comments container',  anyOf: ['#comments', 'ytd-comments'] },
  { name: 'player element',      anyOf: ['#movie_player', '.html5-video-player'] },
  { name: 'player right controls', anyOf: ['.ytp-right-controls'] },
];

function extractSelectors() {
  const css = fs.readFileSync(path.join(EXT_DIR, 'hide.css'), 'utf8');
  const js = ['comments.js', 'start.js', 'player.js']
    .map((f) => fs.readFileSync(path.join(EXT_DIR, f), 'utf8')).join('\n');
  const set = new Set();

  const cleanCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const block of cleanCss.split('}')) {
    const head = block.split('{')[0];
    if (!head || head.trim().startsWith('@')) continue;
    for (const sel of head.split(',')) {
      const s = sel.trim().replace(/\s+/g, ' ');
      if (s) set.add(s);
    }
  }

  const re = /(['"`])([^'"`\n]{2,220}?)\1/g;
  let m;
  while ((m = re.exec(js))) {
    const raw = m[2].trim();
    if (!/[#.\[]/.test(raw)) continue;
    if (!/^[a-zA-Z#*\[.:]/.test(raw)) continue;
    if (/^(https?:|\/)/.test(raw)) continue;
    for (const part of raw.split(',')) {
      const p = part.trim();
      if (!p || !/^[a-zA-Z#*\[.:]/.test(p)) continue;
      if (/\s(>|\+)$/.test(p)) continue;
      set.add(p);
    }
  }
  return [...set].sort();
}

async function main() {
  const selectors = extractSelectors();
  console.log(`Checking structure + ${selectors.length} selectors against ${URL}\n`);

  const page = await launchPage({ port: 9641, extensionDir: EXT_DIR, profileDir: '/tmp/ytlite-verify' });
  try {
    await page.goto(URL);
    await page.evaluate(`new Promise((resolve) => {
      const ready = () => document.querySelector('ytd-watch-flexy, ytd-watch-grid') && document.querySelector('#below');
      if (ready()) return resolve(true);
      const obs = new MutationObserver(() => { if (ready()) { obs.disconnect(); resolve(true); } });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); resolve(false); }, ${SETTLE_MS});
    })`);
    await Bun.sleep(1500);

    const data = await page.evaluate(`(() => {
      const sels = ${JSON.stringify(selectors)};
      const validity = sels.map((s) => {
        try { document.querySelectorAll(s); return { s, invalid: false, count: document.querySelectorAll(s).length }; }
        catch (e) { return { s, invalid: true, error: e.message, count: 0 }; }
      });
      const req = ${JSON.stringify(REQUIRED)};
      const structure = req.map((r) => ({
        name: r.name,
        selector: r.anyOf.join(' or '),
        count: Math.max(...r.anyOf.map((s) => document.querySelectorAll(s).length)),
      }));
      return { validity, structure };
    })()`);

    const invalid = data.validity.filter((r) => r.invalid);
    const structureMissing = data.structure.filter((r) => r.count === 0);

    console.log('STRUCTURE');
    for (const r of data.structure) {
      console.log(`  ${r.count > 0 ? 'ok  ' : 'MISS'}  ${r.name.padEnd(22)} (${r.selector}) -> ${r.count}`);
    }

    console.log(`\nSELECTOR VALIDITY: ${data.validity.length - invalid.length}/${data.validity.length} parse cleanly`);
    if (invalid.length) {
      console.log('  invalid selectors:');
      for (const r of invalid) console.log(`    - ${r.s}  (${r.error})`);
    }

    const matched = data.validity.filter((r) => !r.invalid && r.count > 0).length;
    console.log(`  currently matching on this page: ${matched}`);
    console.log(`  not present here (other page state): ${data.validity.length - matched - invalid.length}`);

    const ok = structureMissing.length === 0 && invalid.length === 0;
    console.log(`\n${ok ? 'OK: structure intact and all selectors valid.' : 'FAIL: selector drift detected.'}`);
    // Signal the exit code without process.exit(), which would skip the
    // `finally` block and orphan the browser process.
    process.exitCode = ok ? 0 : 1;
  } finally {
    await page.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
