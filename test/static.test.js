// Static guardrails: enforce the AGENTS.md performance rules and manifest/DNR
// integrity without needing a browser. These fail loudly if a future edit
// reintroduces an expensive pattern.
import { test, expect, describe } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

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
    for (const icon of Object.values(manifest.icons)) expect(fs.existsSync(path.join(ROOT, icon))).toBe(true);
    for (const cs of manifest.content_scripts) {
      for (const f of [...(cs.js || []), ...(cs.css || [])]) expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
    }
    expect(fs.existsSync(path.join(ROOT, manifest.background.service_worker))).toBe(true);
    for (const r of manifest.declarative_net_request.rule_resources) expect(fs.existsSync(path.join(ROOT, r.path))).toBe(true);
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
    const tracked = extraFiles.filter((e) => e.jsonpath === '$.version').map((e) => e.path);
    expect(tracked).toContain('manifest.json');
    expect(tracked).toContain('package.json');
  });

  test('requests no unnecessary (JS-cost) permissions', () => {
    expect(manifest.permissions).toEqual(['declarativeNetRequest']);
    expect(manifest.permissions).not.toContain('tabs');
    expect(manifest.permissions).not.toContain('webRequest');
    expect(manifest.host_permissions).toEqual(['*://www.youtube.com/*', '*://youtube.com/*']);
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
      expect(cs.matches).toEqual(['*://www.youtube.com/*', '*://youtube.com/*']);
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
    for (const needle of ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'google-analytics.com', 'log_event', 'feedback']) {
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
    for (const needle of ['doubleclick.net', 'google-analytics.com', 'googlesyndication.com', 'googleadservices.com']) {
      const rule = rules.find((r) => r.condition.urlFilter.includes(needle));
      // Third-party hostnames cannot be matched by requestDomains, so these must
      // gate on who is asking, not on where the request goes.
      expect(rule.condition.initiatorDomains).toEqual(['www.youtube.com']);
    }
  });

  test('no rule is scoped to a YouTube subdomain other than www', () => {
    // music.youtube.com and m.youtube.com are separate products with their own DOM.
    for (const r of rules) {
      const scoped = r.condition.initiatorDomains || r.condition.requestDomains || [];
      expect(scoped.some((d) => d.startsWith('music.') || d.startsWith('m.'))).toBe(false);
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
    for (const f of jsFiles) expect(read(f).includes('setInterval')).toBe(false);
  });

  test('never observes document.body with subtree: true', () => {
    const src = read('comments.js');
    expect(/document\.body[^\n]*subtree:\s*true/.test(src)).toBe(false);
    // The comment-button observer must stay non-subtree.
    expect(src.includes("observer.observe(target, { childList: true, subtree: false })")).toBe(true);
  });

  test('blur/shadows are only ever set to none, never enabled', () => {
    const backdrop = [...css.matchAll(/backdrop-filter:\s*([^;]+);/g)].map((m) => m[1].trim());
    const shadows = [...css.matchAll(/box-shadow:\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const v of [...backdrop, ...shadows]) expect(v).toBe('none !important');
  });

  test('ambient canvas and transitions are neutralized', () => {
    expect(css.includes('.ytp-ambient-canvas')).toBe(true);
  });

  test('the default suite stays browser-free', () => {
    // `bun test` must not launch Chrome. Anything needing a browser lives in bench/.
    const testFiles = fs.readdirSync(path.join(ROOT, 'test'))
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
    const applied = [...src.matchAll(/applyQuality\(([^)]*)\)/g)].map((m) => m[1].trim());
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
    for (const method of ['getVideoData', 'setCollapsedState', 'onShowHideChat']) {
      expect(src.includes(method)).toBe(false);
    }
  });
});

describe('continuation and legacy-cleanup scoping', () => {
  test('the continuation click is scoped to the continuation element', () => {
    // Regression: a bare [role="button"] inside #comments can match the sort menu,
    // so the click opened a menu instead of loading comments.
    const src = read('comments.js');
    const call = src.match(/const continuation = comments\.querySelector\(([^)]*)\)/);
    expect(call).not.toBeNull();
    expect(call[1]).toContain('ytd-continuation-item-renderer');
    const loose = src.match(/comments\.querySelector\([^)]*\[role="button"\][^)]*\)/);
    expect(loose).toBeNull();
  });

  test('background.js only ever removes its own legacy rule ids', () => {
    // Regression: the handler removed every dynamic rule, so a future build's
    // rules would be wiped on each install.
    const src = read('background.js');
    expect(src.includes('LEGACY_RULE_IDS')).toBe(true);
    expect(/existing\.map\(\s*\(?r\)?\s*=>\s*r\.id\s*\)\s*;?\s*$/.test(src)).toBe(false);
    expect(src.includes('filter((id) => present.has(id))')).toBe(true);
  });
});
