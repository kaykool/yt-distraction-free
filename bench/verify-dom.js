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
// Usage: bun run verify:dom [url ...]
//        VERIFY_URLS=url1,url2 bun run verify:dom
import fs from 'node:fs';
import path from 'node:path';
import { resolveVerifyUrls, verifyAcrossUrls } from './browser.js';

const EXT_DIR = path.resolve(import.meta.dir, '..');
const SETTLE_MS = Number(process.env.BENCH_SETTLE_MS || 9000);

// Anchors the extension's logic depends on for a normal watch page.
// `anyOf` groups express "YouTube may serve either flavour of this element".
const REQUIRED = [
  { name: 'watch container', anyOf: ['ytd-watch-flexy', 'ytd-watch-grid'] },
  { name: 'primary column', anyOf: ['#primary'] },
  { name: 'primary-inner', anyOf: ['#primary-inner'] },
  { name: 'below fold', anyOf: ['#below'] },
  { name: 'secondary column', anyOf: ['#secondary'] },
  { name: 'watch metadata', anyOf: ['ytd-watch-metadata'] },
  { name: 'comments container', anyOf: ['#comments', 'ytd-comments'] },
  { name: 'player element', anyOf: ['#movie_player', '.html5-video-player'] },
  { name: 'player right controls', anyOf: ['.ytp-right-controls'] },
];

export function extractSelectors() {
  const css = fs.readFileSync(path.join(EXT_DIR, 'hide.css'), 'utf8');
  const js = ['comments.js', 'start.js', 'player.js']
    .map((f) => fs.readFileSync(path.join(EXT_DIR, f), 'utf8'))
    .join('\n');
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

export async function runVerifyDom(urls = resolveVerifyUrls(), deps = {}) {
  const selectors = extractSelectors();
  const log = deps.log || console.log;

  return verifyAcrossUrls(urls, {
    port: 9641,
    extensionDir: EXT_DIR,
    profileDir: '/tmp/ytlite-verify',
    settleMs: SETTLE_MS,
    ...deps,
    beforeUrl: (url) =>
      log(
        `Checking structure + ${selectors.length} selectors against ${url}\n`
      ),
    verifyPage: async (page) => {
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

      log('STRUCTURE');
      for (const r of data.structure) {
        log(
          `  ${r.count > 0 ? 'ok  ' : 'MISS'}  ${r.name.padEnd(22)} (${r.selector}) -> ${r.count}`
        );
      }

      log(
        `\nSELECTOR VALIDITY: ${data.validity.length - invalid.length}/${data.validity.length} parse cleanly`
      );
      if (invalid.length) {
        log('  invalid selectors:');
        for (const r of invalid) log(`    - ${r.s}  (${r.error})`);
      }

      const matched = data.validity.filter(
        (r) => !r.invalid && r.count > 0
      ).length;
      log(`  currently matching on this page: ${matched}`);
      log(
        `  not present here (other page state): ${data.validity.length - matched - invalid.length}`
      );

      const ok = structureMissing.length === 0 && invalid.length === 0;
      log(
        `\n${ok ? 'OK: structure intact and all selectors valid.' : 'FAIL: selector drift detected.'}`
      );
      return ok;
    },
  });
}

async function main() {
  const summary = await runVerifyDom(resolveVerifyUrls());
  // Signal the exit code without process.exit(), which would skip cleanup.
  process.exitCode = summary.ok ? 0 : 1;
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
