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
    expect(manifest.host_permissions).toEqual(['*://*.youtube.com/*']);
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
});
