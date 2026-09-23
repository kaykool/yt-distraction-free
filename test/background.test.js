// background.js runs as a service worker: there is no DOM and no page to drive.
// These tests inject a fake `chrome` global and execute the real file, so the
// cleanup behavior is pinned without a browser.
import { test, expect, describe } from 'bun:test';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

// Values created inside a vm context belong to a different realm, so their arrays
// and objects have foreign prototypes and fail a direct toEqual comparison against
// host literals. Round-tripping through JSON normalizes them to host values.
const plain = (v) => JSON.parse(JSON.stringify(v));

function runBackground({ dynamicRules = [], failGet = false } = {}) {
  const calls = { updateDynamicRules: [], getDynamicRules: 0 };
  let installedHandler = null;

  const chrome = {
    runtime: {
      onInstalled: {
        addListener(fn) { installedHandler = fn; },
      },
    },
    declarativeNetRequest: {
      async getDynamicRules() {
        calls.getDynamicRules++;
        if (failGet) throw new Error('denied');
        return dynamicRules;
      },
      async updateDynamicRules(arg) {
        calls.updateDynamicRules.push(arg);
      },
    },
  };

  const ctx = vm.createContext({ chrome, console, Promise, Set, Array, Number });
  vm.runInContext(SOURCE, ctx, { filename: 'background.js' });
  return { chrome, calls, getHandler: () => installedHandler };
}

describe('background.js: legacy dynamic rule cleanup', () => {
  test('registers an onInstalled listener', () => {
    const { getHandler } = runBackground();
    expect(typeof getHandler()).toBe('function');
  });

  test('removes exactly the legacy rule ids that are present', async () => {
    const { calls, getHandler } = runBackground({
      dynamicRules: [{ id: 1001 }, { id: 1002 }, { id: 1003 }],
    });
    await getHandler()();
    expect(plain(calls.updateDynamicRules)).toEqual([{ removeRuleIds: [1001, 1002, 1003] }]);
  });

  test('never removes ids that are not legacy', async () => {
    // Regression: the handler used to map over *every* existing rule, so it would
    // have wiped dynamic rules belonging to a future build.
    const { calls, getHandler } = runBackground({
      dynamicRules: [{ id: 1001 }, { id: 4242 }, { id: 7 }],
    });
    await getHandler()();
    expect(plain(calls.updateDynamicRules)).toEqual([{ removeRuleIds: [1001] }]);
  });

  test('makes no update call when no legacy rule exists', async () => {
    const { calls, getHandler } = runBackground({ dynamicRules: [{ id: 4242 }] });
    await getHandler()();
    expect(plain(calls.updateDynamicRules)).toEqual([]);
  });

  test('is a no-op on a fresh install', async () => {
    const { calls, getHandler } = runBackground({ dynamicRules: [] });
    await getHandler()();
    expect(plain(calls.updateDynamicRules)).toEqual([]);
  });

  test('a failing getDynamicRules does not reject the install', async () => {
    const { calls, getHandler } = runBackground({ failGet: true });
    // Rejecting here would surface as an unchecked service-worker error. The
    // returned promise comes from the vm realm, so it is awaited directly rather
    // than through `expect().resolves`, which does not accept foreign thenables.
    let rejected = false;
    let value = 'unset';
    try {
      value = await getHandler()();
    } catch (_) {
      rejected = true;
    }
    expect(rejected).toBe(false);
    expect(value).toBeUndefined();
    expect(plain(calls.updateDynamicRules)).toEqual([]);
  });

  test('the legacy id list is the documented 1001-1003 range', () => {
    const list = SOURCE.match(/LEGACY_RULE_IDS\s*=\s*\[([^\]]*)\]/);
    expect(list).not.toBeNull();
    const ids = list[1].split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
    expect(ids).toEqual([1001, 1002, 1003]);
  });
});
