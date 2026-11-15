// Static guardrails: enforce the AGENTS.md performance rules and manifest/DNR
// integrity without needing a browser. These fail loudly if a future edit
// reintroduces an expensive pattern.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_VERIFY_URL, resolveVerifyUrls } from '../bench/browser.js';
import { runVerifyDom } from '../bench/verify-dom.js';
import { runVerifyCss } from '../bench/verify-css.js';

const ROOT = path.resolve(import.meta.dir, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const rules = JSON.parse(read('rules.json'));

describe('manifest.json', () => {
  test('is MV3 with the expected content scripts', () => {
    expect(manifest.manifest_version).toBe(3);
    const scripts = manifest.content_scripts;
    const byFile = Object.fromEntries(scripts.map((s) => [s.js.join(','), s]));
    expect(byFile['start.js'].run_at).toBe('document_start');
    expect(byFile['start.js'].css).toEqual(['hide.css']);
    expect(byFile['player.js'].world).toBe('MAIN');
    expect(byFile['player.js'].run_at).toBe('document_start');
    expect(byFile['comments.js'].run_at).toBe('document_idle');
  });

  test('every referenced file exists on disk', () => {
    for (const icon of Object.values(manifest.icons))
      expect(fs.existsSync(path.join(ROOT, icon))).toBe(true);
    for (const cs of manifest.content_scripts) {
      for (const f of [...(cs.js || []), ...(cs.css || [])])
        expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
    }
    expect(
      fs.existsSync(path.join(ROOT, manifest.background.service_worker))
    ).toBe(true);
    for (const r of manifest.declarative_net_request.rule_resources)
      expect(fs.existsSync(path.join(ROOT, r.path))).toBe(true);
  });

  test('version is consistent across manifest, package and release-please', () => {
    const rel = JSON.parse(read('.release-please-manifest.json'));
    const pkg = JSON.parse(read('package.json'));
    expect(manifest.version).toBe(rel['.']);
    expect(pkg.version).toBe(rel['.']);
  });

  test('release-please is configured to keep both version files in sync', () => {
    const config = JSON.parse(read('release-please-config.json'));
    const extraFiles = config.packages['.']['extra-files'];
    const tracked = extraFiles
      .filter((e) => e.jsonpath === '$.version')
      .map((e) => e.path);
    expect(tracked).toContain('manifest.json');
    expect(tracked).toContain('package.json');
  });

  test('requests no unnecessary (JS-cost) permissions', () => {
    expect(manifest.permissions).toEqual(['declarativeNetRequest']);
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('webRequest');
    expect(manifest.host_permissions).toEqual([
      '*://www.youtube.com/*',
      '*://youtube.com/*',
    ]);
  });

  test('never runs on non-YouTube subdomains', () => {
    // Regression: *://*.youtube.com/* also matched music.youtube.com, where hide.css
    // silently restyled elements the extension was never meant to touch.
    const patterns = [
      ...manifest.host_permissions,
      ...manifest.content_scripts.flatMap((cs) => cs.matches),
    ];
    for (const p of patterns) {
      expect(p).not.toContain('*.youtube.com');
    }
    for (const cs of manifest.content_scripts) {
      expect(cs.matches).toEqual([
        '*://www.youtube.com/*',
        '*://youtube.com/*',
      ]);
    }
  });
});

describe('rules.json (declarative ad/telemetry blocking)', () => {
  test('all rules use the native block action', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r.action.type).toBe('block');
  });

  test('rule ids are unique positive integers', () => {
    const ids = rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(Number.isInteger(id) && id > 0).toBe(true);
  });

  test('blocks the documented ad/tracker and telemetry endpoints', () => {
    const filters = rules.map((r) => r.condition.urlFilter);
    for (const needle of [
      'doubleclick.net',
      'googlesyndication.com',
      'googleadservices.com',
      'google-analytics.com',
      'log_event',
      'feedback',
    ]) {
      expect(filters.some((f) => f.includes(needle))).toBe(true);
    }
  });

  test('every rule is scoped to YouTube, never global', () => {
    // Regression: unscoped rules blocked DoubleClick/GA on every site the user
    // visited, despite the extension advertising itself as YouTube-only.
    for (const r of rules) {
      const scoped = r.condition.initiatorDomains || r.condition.requestDomains;
      expect(Array.isArray(scoped) && scoped.length > 0).toBe(true);
      expect(scoped).toEqual(['www.youtube.com']);
    }
  });

  test('tracker requests are scoped by initiator so only YouTube loses them', () => {
    for (const needle of [
      'doubleclick.net',
      'google-analytics.com',
      'googlesyndication.com',
      'googleadservices.com',
    ]) {
      const rule = rules.find((r) => r.condition.urlFilter.includes(needle));
      // Third-party hostnames cannot be matched by requestDomains, so these must
      // gate on who is asking, not on where the request goes.
      expect(rule.condition.initiatorDomains).toEqual(['www.youtube.com']);
    }
  });

  test('no rule is scoped to a YouTube subdomain other than www', () => {
    // music.youtube.com and m.youtube.com are separate products with their own DOM.
    for (const r of rules) {
      const scoped =
        r.condition.initiatorDomains || r.condition.requestDomains || [];
      expect(
        scoped.some((d) => d.startsWith('music.') || d.startsWith('m.'))
      ).toBe(false);
    }
  });
});

describe('performance guardrails (AGENTS.md §3)', () => {
  const jsFiles = ['comments.js', 'player.js', 'start.js', 'background.js'];
  // Strip CSS comments so prose mentioning a forbidden pattern is not flagged.
  const css = read('hide.css').replace(/\/\*[\s\S]*?\*\//g, '');

  test('no :has() selectors anywhere in CSS', () => {
    expect(css.includes(':has(')).toBe(false);
  });

  test('no setInterval / recursive polling in scripts', () => {
    for (const f of jsFiles)
      expect(read(f).includes('setInterval')).toBe(false);
  });

  test('never registers document-wide click or keyup handlers for sidebar polling', () => {
    const src = read('comments.js')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(
      /document\.addEventListener\(\s*['"](?:click|keyup)['"]/.test(src)
    ).toBe(false);
  });

  test('never observes document.body with subtree: true', () => {
    const src = read('comments.js');
    expect(/document\.body[^\n]*subtree:\s*true/.test(src)).toBe(false);
    // The comment-button observer must stay non-subtree.
    expect(
      src.includes(
        'observer.observe(target, { childList: true, subtree: false })'
      )
    ).toBe(true);
  });

  test('never observes #primary-inner with subtree: true', () => {
    const src = read('comments.js')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(/#primary-inner[\s\S]{0,600}subtree:\s*true/.test(src)).toBe(false);
    const fns = src
      .split(/(?=\bfunction\s+)/)
      .filter((fn) => /subtree:\s*true/.test(fn));
    expect(fns.length).toBeGreaterThan(0);
    for (const fn of fns) {
      expect(fn.includes('#primary-inner')).toBe(false);
      expect(/\bprimaryInner\b/.test(fn)).toBe(false);
      expect(fn.includes('document.body')).toBe(false);
    }
  });

  test('startScopedObserver never falls back to document.body', () => {
    const src = read('comments.js')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const fn = src
      .split(/(?=\bfunction\s+)/)
      .find((f) => f.startsWith('function startScopedObserver'));
    expect(fn).toBeDefined();
    expect(fn.includes('document.body')).toBe(false);
    expect(fn.includes('ytd-page-manager')).toBe(true);
    expect(fn.includes('ytd-app')).toBe(true);
  });

  test('blur/shadows are only ever set to none, never enabled', () => {
    const backdrop = [...css.matchAll(/backdrop-filter:\s*([^;]+);/g)].map(
      (m) => m[1].trim()
    );
    const shadows = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) =>
      m[1].trim()
    );
    for (const v of [...backdrop, ...shadows])
      expect(v).toBe('none !important');
  });

  test('ambient canvas and transitions are neutralized', () => {
    expect(css.includes('.ytp-ambient-canvas')).toBe(true);
  });

  test('hide.css keeps pure CSS #related suppression without malformed or duplicate declarations', () => {
    const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
      selectors: m[1]
        .split(',')
        .map((s) => s.trim().replace(/\s+/g, ' '))
        .filter(Boolean),
      body: m[2],
    }));

    // #related must remain suppressed purely in CSS.
    const relatedBlock = blocks.find((b) => b.selectors.includes('#related'));
    expect(relatedBlock).toBeDefined();
    expect(relatedBlock.body).toMatch(/display\s*:\s*none\s*!important/);

    // Teaser carousel must be its own rule, never concatenated with description cleanup selectors.
    const teaserBlock = blocks.find((b) =>
      b.selectors.includes('#teaser-carousel')
    );
    expect(teaserBlock).toBeDefined();
    expect(teaserBlock.selectors).toEqual([
      '#teaser-carousel',
      'yt-video-metadata-carousel-view-model',
    ]);
    expect(teaserBlock.body).toMatch(/display\s*:\s*none\s*!important/);

    // No block should repeat both background-color and background shorthand.
    for (const b of blocks) {
      const props = [...b.body.matchAll(/([a-z-]+)\s*:/gi)].map((m) =>
        m[1].toLowerCase()
      );
      expect(
        props.includes('background-color') && props.includes('background')
      ).toBe(false);
    }
  });

  test('extension .ytlite-* rules declare no active CSS transitions', () => {
    const ytliteTransitions = [];
    for (const block of css.split('}')) {
      const [head, body] = block.split('{');
      if (!head || !body || !head.includes('.ytlite-')) continue;
      for (const m of body.matchAll(
        /\btransition(?:-duration|-property|-delay|-timing-function)?\s*:\s*([^;]+);/gi
      )) {
        ytliteTransitions.push({ selector: head.trim(), value: m[1].trim() });
      }
    }
    expect(
      ytliteTransitions.filter(
        (t) => !/^none(?:\s+!important)?$/i.test(t.value)
      )
    ).toEqual([]);
  });

  test('the default suite stays browser-free', () => {
    // `bun test` must not launch Chrome. Anything needing a browser lives in bench/.
    const testFiles = fs
      .readdirSync(path.join(ROOT, 'test'))
      .filter((f) => f.endsWith('.test.js') && f !== 'static.test.js');
    expect(testFiles.length).toBeGreaterThan(0);
    for (const f of testFiles) {
      const src = read(path.join('test', f)).replace(/\/\/[^\n]*/g, '');
      expect(/from\s+['"][^'"]*bench\//.test(src)).toBe(false);
      expect(/\blaunchPage\b/.test(src)).toBe(false);
    }
  });
});

describe('playback quality is never touched while audio-only is off', () => {
  test('player.js only ever forces 144p, never a higher level', () => {
    // Regression: applyQuality('480') pinned 480p on every load and SPA navigation,
    // overriding whatever quality the user had selected in YouTube's own menu.
    const src = read('player.js');
    const applied = [...src.matchAll(/applyQuality\(([^)]*)\)/g)].map((m) =>
      m[1].trim()
    );
    expect(applied.length).toBeGreaterThan(0);
    for (const arg of applied) {
      expect(/^'144'$|^target$|^previous$/.test(arg)).toBe(true);
    }
    expect(/applyQuality\(\s*'480'/.test(src)).toBe(false);
  });

  test('the isolated-world script never calls page-JS player methods', () => {
    // getVideoData / setCollapsedState / onShowHideChat are page-world expandos and
    // are always undefined in the isolated world content scripts run in.
    const src = read('comments.js').replace(/\/\/[^\n]*/g, '');
    for (const method of [
      'getVideoData',
      'setCollapsedState',
      'onShowHideChat',
    ]) {
      expect(src.includes(method)).toBe(false);
    }
  });

  test('ytlite-set-quality dispatches omit unused detail payloads', () => {
    const src = read('comments.js');
    const matches = [
      ...src.matchAll(/new CustomEvent\(['"]ytlite-set-quality['"]([^)]*)\)/g),
    ];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) {
      expect(m[1].trim()).toBe('');
    }
  });

  test('Audio-Only Mode pairs content-visibility: hidden with visibility: hidden on <video>', () => {
    const css = read('hide.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const block = css
      .split('}')
      .find(
        (b) => b.includes('html.ytlite-video-blocked') && b.includes('video')
      );
    expect(block).toBeDefined();
    expect(block).toContain('content-visibility: hidden !important');
    expect(block).toContain('visibility: hidden !important');
  });
});

describe('continuation and legacy-cleanup scoping', () => {
  test('the continuation click is scoped to the continuation element', () => {
    // Regression: a bare [role="button"] inside #comments can match the sort menu,
    // so the click opened a menu instead of loading comments.
    const src = read('comments.js');
    const call = src.match(
      /const continuation = comments\.querySelector\(([^)]*)\)/
    );
    expect(call).not.toBeNull();
    expect(call[1]).toContain('ytd-continuation-item-renderer');
    const loose = src.match(
      /comments\.querySelector\([^)]*\[role="button"\][^)]*\)/
    );
    expect(loose).toBeNull();
  });

  test('background.js only ever removes its own legacy rule ids', () => {
    // Regression: the handler removed every dynamic rule, so a future build's
    // rules would be wiped on each install.
    const src = read('background.js');
    expect(src.includes('LEGACY_RULE_IDS')).toBe(true);
    expect(
      /existing\.map\(\s*\(?r\)?\s*=>\s*r\.id\s*\)\s*;?\s*$/.test(src)
    ).toBe(false);
    expect(src.includes('filter((id) => present.has(id))')).toBe(true);
  });
});

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/[^\n]*/g, '$1');

describe('verification harness integrity (verify-css & blink-parity)', () => {
  test('verify-css.js never awaits unguarded video.play() outside bounded(...)', () => {
    const src = stripComments(read('bench/verify-css.js'));
    expect(
      /const\s+bounded\s*=\s*\([^)]*\)\s*=>[\s\S]*?Promise\.race\([\s\S]*?setTimeout/.test(
        src
      )
    ).toBe(true);
    expect(/\bawait\s+video\.play\s*\(/.test(src)).toBe(false);

    const awaitedPlayCalls = [
      ...src.matchAll(/\bawait\b[^;{}]*?\bvideo\.play\s*\(/g),
    ].map((m) => m[0]);
    expect(awaitedPlayCalls.length).toBeGreaterThan(0);
    for (const call of awaitedPlayCalls) {
      expect(/^await\s+bounded\(\s*video\.play\s*\(/.test(call)).toBe(true);
    }
  });

  test('verify-css.js never uses silent escape hatches on mandatory live checks', () => {
    const src = stripComments(read('bench/verify-css.js'));
    expect(/!hasQualityApi\s*\|\|/.test(src)).toBe(false);
    expect(
      /if\s*\(\s*!hasQualityApi\s*\)\s*(?:\{\s*)?return\s*\{\s*ok:\s*true\b/.test(
        src
      )
    ).toBe(false);
    expect(
      /if\s*\(\s*!hasQualityApi\s*\)\s*(?:\{\s*)?return\s*\{\s*ok:\s*false\b/.test(
        src
      )
    ).toBe(true);

    expect(
      /if\s*\(\s*!hideBtn\s*\)\s*(?:\{\s*)?return\s*\{\s*ok:\s*true\b/.test(src)
    ).toBe(false);
    expect(
      /if\s*\(\s*!hideBtn\s*\)\s*(?:\{\s*)?return\s*\{\s*ok:\s*false\b/.test(
        src
      )
    ).toBe(true);

    expect(
      /if\s*\(\s*!btn\s*\|\|\s*!video\s*\|\|\s*!mp\s*\)\s*(?:\{\s*)?return\s*\{\s*ok:\s*false\b/.test(
        src
      )
    ).toBe(true);
    expect(
      /if\s*\(\s*!btn\s*\|\|\s*!comments\s*\)\s*(?:\{\s*)?return\s*\{\s*ok:\s*false\b/.test(
        src
      )
    ).toBe(true);
  });

  test('verify-css.js includes diagnostic video and ad state when playback readiness fails', () => {
    const src = stripComments(read('bench/verify-css.js'));
    const audioBlock = src.slice(src.indexOf("name: 'interactive: AudioOnly"));
    expect(audioBlock).toContain('if (!ready)');
    expect(audioBlock).toContain('video.readyState');
    expect(audioBlock).toContain('video.networkState');
    expect(audioBlock).toContain('video.paused');
    expect(audioBlock).toContain('video.currentSrc');
    expect(audioBlock.includes('Boolean(video.currentSrc)')).toBe(false);
    expect(audioBlock).toContain('ad-showing');
    expect(audioBlock).toContain('ad-interrupting');
  });

  test('DOM-shim special selector syntax has matching assertions in bench/blink-parity.js', () => {
    const domSrc = stripComments(read('test/dom.js'));
    const paritySrc = stripComments(read('bench/blink-parity.js'));

    // Confirm which special selector syntax test/dom.js supports.
    expect(domSrc).toContain("startsWith('*')");
    expect(domSrc).toContain('extractNots');
    expect(domSrc).toContain("comb === '>'");
    expect(domSrc).toContain("comb === '+'");
    expect(domSrc).toContain("comb === '~'");

    // Extract literal selector assertions from collectSelectors() in bench/blink-parity.js.
    const collectSection = paritySrc.slice(
      paritySrc.indexOf('function collectSelectors()'),
      paritySrc.indexOf('const SELECTORS =')
    );
    const selectors = [
      ...collectSection.matchAll(/(['"])((?:\\.|(?!\1).)+)\1/g),
    ].map((m) => m[2]);
    expect(selectors.length).toBeGreaterThan(0);

    // Universal `*` and `*`-prefixed compound stripping (`*.class` / `*#id` / `*[attr]`).
    expect(selectors.some((s) => s === '*')).toBe(true);
    expect(selectors.some((s) => /^\*[.#\[]/.test(s))).toBe(true);
    // `:not(...)` negation.
    expect(selectors.some((s) => /:not\([^)]+\)/.test(s))).toBe(true);
    // Child `>`, adjacent sibling `+`, and general sibling `~` combinators.
    expect(selectors.some((s) => /[^>]+>\s*[^>\s]+/.test(s))).toBe(true);
    expect(selectors.some((s) => /\+\s*[^\s+]/.test(s))).toBe(true);
    expect(selectors.some((s) => /~\s*[^\s~]/.test(s))).toBe(true);

    expect(paritySrc).toContain('expect({ sel, count: shimRes[sel] }).toEqual');
  });
});

describe('multi-URL verification support', () => {
  test('resolveVerifyUrls supports positional args, VERIFY_URLS, VERIFY_URL, and default fallback', () => {
    expect(resolveVerifyUrls([], {})).toEqual([DEFAULT_VERIFY_URL]);
    expect(resolveVerifyUrls(['https://www.youtube.com/live/abc'], {})).toEqual(
      ['https://www.youtube.com/live/abc']
    );
    expect(
      resolveVerifyUrls(
        ['https://www.youtube.com/watch?v=1', 'https://www.youtube.com/live/2'],
        { VERIFY_URLS: 'https://ignored', VERIFY_URL: 'https://ignored-single' }
      )
    ).toEqual([
      'https://www.youtube.com/watch?v=1',
      'https://www.youtube.com/live/2',
    ]);
    expect(
      resolveVerifyUrls([], {
        VERIFY_URLS:
          ' https://www.youtube.com/watch?v=1 , , https://www.youtube.com/live/2 ',
        VERIFY_URL: 'https://ignored-single',
      })
    ).toEqual([
      'https://www.youtube.com/watch?v=1',
      'https://www.youtube.com/live/2',
    ]);
    expect(
      resolveVerifyUrls(['', ' -- '], {
        VERIFY_URLS: ' , ',
        VERIFY_URL: ' https://www.youtube.com/watch?v=single ',
      })
    ).toEqual(['https://www.youtube.com/watch?v=single']);
  });

  test('runVerifyDom verifies all URLs sequentially, counts failures, and closes every session', async () => {
    const visited = [];
    let closedCount = 0;
    const fakeLaunch = async () => {
      let currentUrl = '';
      return {
        async goto(url) {
          currentUrl = url;
          visited.push(url);
          if (url.includes('boom')) throw new Error('navigation failed');
        },
        async evaluate() {
          if (currentUrl.includes('drift')) {
            return {
              validity: [
                { s: '#bad', invalid: true, error: 'syntax', count: 0 },
              ],
              structure: [
                {
                  name: 'watch container',
                  selector: 'ytd-watch-flexy',
                  count: 0,
                },
              ],
            };
          }
          return {
            validity: [{ s: '#comments', invalid: false, count: 1 }],
            structure: [
              {
                name: 'watch container',
                selector: 'ytd-watch-flexy',
                count: 1,
              },
            ],
          };
        },
        async close() {
          closedCount++;
        },
      };
    };

    const okRun = await runVerifyDom(
      [
        'https://www.youtube.com/watch?v=ok1',
        'https://www.youtube.com/live/ok2',
      ],
      {
        launch: fakeLaunch,
        waitReady: async () => true,
        sleep: async () => {},
        rmSync: () => {},
        log: () => {},
      }
    );
    expect(okRun.ok).toBe(true);
    expect(okRun.failed).toBe(0);
    expect(okRun.passed).toBe(2);
    expect(visited).toEqual([
      'https://www.youtube.com/watch?v=ok1',
      'https://www.youtube.com/live/ok2',
    ]);
    expect(closedCount).toBe(2);

    visited.length = 0;
    closedCount = 0;
    const mixedRun = await runVerifyDom(
      [
        'https://www.youtube.com/watch?v=drift',
        'https://www.youtube.com/watch?v=boom',
        'https://www.youtube.com/live/good',
      ],
      {
        launch: fakeLaunch,
        waitReady: async () => true,
        sleep: async () => {},
        rmSync: () => {},
        log: () => {},
      }
    );
    expect(mixedRun.ok).toBe(false);
    expect(mixedRun.passed).toBe(1);
    expect(mixedRun.failed).toBe(2);
    expect(visited).toEqual([
      'https://www.youtube.com/watch?v=drift',
      'https://www.youtube.com/watch?v=boom',
      'https://www.youtube.com/live/good',
    ]);
    expect(closedCount).toBe(3);
  });

  test('runVerifyCss verifies all URLs sequentially, counts failures, bounds checks, and clears timers', async () => {
    const src = stripComments(read('bench/verify-css.js'));
    expect(src).toContain('clearTimeout(');

    const visited = [];
    let closedCount = 0;
    const fakeLaunch = async () => {
      let currentUrl = '';
      let checkIdx = 0;
      return {
        async goto(url) {
          currentUrl = url;
          visited.push(url);
          if (url.includes('nav-err')) throw new Error('nav failed');
        },
        async evaluate() {
          const idx = checkIdx++;
          if (currentUrl.includes('broken') && idx === 0) {
            return { ok: false, detail: 'comments visible' };
          }
          if (currentUrl.includes('hang') && idx === 0) {
            return new Promise(() => {});
          }
          return { ok: true, detail: 'ok' };
        },
        async close() {
          closedCount++;
        },
      };
    };

    const okRun = await runVerifyCss(
      ['https://www.youtube.com/watch?v=v1', 'https://www.youtube.com/live/l1'],
      {
        launch: fakeLaunch,
        waitReady: async () => true,
        sleep: async () => {},
        rmSync: () => {},
        log: () => {},
        checkTimeoutMs: 50,
      }
    );
    expect(okRun.ok).toBe(true);
    expect(okRun.passed).toBe(2);
    expect(okRun.failed).toBe(0);
    expect(closedCount).toBe(2);

    visited.length = 0;
    closedCount = 0;
    const failRun = await runVerifyCss(
      [
        'https://www.youtube.com/watch?v=broken',
        'https://www.youtube.com/watch?v=nav-err',
        'https://www.youtube.com/live/hang',
        'https://www.youtube.com/live/good',
      ],
      {
        launch: fakeLaunch,
        waitReady: async () => true,
        sleep: async () => {},
        rmSync: () => {},
        log: () => {},
        checkTimeoutMs: 25,
      }
    );
    expect(failRun.ok).toBe(false);
    expect(failRun.passed).toBe(1);
    expect(failRun.failed).toBe(3);
    expect(visited).toEqual([
      'https://www.youtube.com/watch?v=broken',
      'https://www.youtube.com/watch?v=nav-err',
      'https://www.youtube.com/live/hang',
      'https://www.youtube.com/live/good',
    ]);
    expect(closedCount).toBe(4);
  });
});
