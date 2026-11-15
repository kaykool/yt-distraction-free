// Launches headless Chrome (optionally with the unpacked extension) and returns a
// page session plus lifecycle helpers used by the benchmark.
import fs from 'node:fs';
import { connect } from './cdp.js';

const CHROME_BIN = process.env.CHROME_BIN || 'google-chrome';

export const DEFAULT_VERIFY_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

export function resolveVerifyUrls(
  argv = process.argv.slice(2),
  env = process.env
) {
  const cli = argv.map((s) => String(s).trim()).filter((s) => s && s !== '--');
  if (cli.length > 0) return cli;
  const multi = String(env.VERIFY_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (multi.length > 0) return multi;
  const single = String(env.VERIFY_URL || '').trim();
  if (single) return [single];
  return [DEFAULT_VERIFY_URL];
}

export async function verifyAcrossUrls(
  urls,
  {
    port,
    extensionDir,
    profileDir,
    readyExpr = "document.querySelector('ytd-watch-flexy, ytd-watch-grid') && document.querySelector('#below')",
    settleMs = 9000,
    launch = launchPage,
    waitReady = waitForReady,
    sleep = (ms) => Bun.sleep(ms),
    rmSync = (dir) => fs.rmSync(dir, { recursive: true, force: true }),
    log = console.log,
    beforeUrl,
    verifyPage,
  }
) {
  let failed = 0;
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (i > 0) log('');
    if (beforeUrl) beforeUrl(url);
    let ok = false;
    let page = null;
    try {
      rmSync(profileDir);
      page = await launch({ port, extensionDir, profileDir });
      await page.goto(url);
      await waitReady(page.evaluate, readyExpr, settleMs);
      await sleep(1500);
      ok = Boolean(await verifyPage(page, url));
    } catch (err) {
      log(`FAIL: ${url} (${err?.message || err})`);
      ok = false;
    } finally {
      if (page) await page.close();
    }
    if (!ok) failed++;
    results.push({ url, ok });
  }
  const passed = urls.length - failed;
  if (urls.length > 1) {
    log(`\nSUMMARY: ${passed}/${urls.length} URL(s) passed.`);
  }
  return { ok: failed === 0, total: urls.length, passed, failed, results };
}

export async function launchPage({
  port,
  extensionDir = null,
  profileDir,
  windowSize = '1280,900',
}) {
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    // Never autoplay media: an orphaned renderer decoding video pins a CPU core.
    '--autoplay-policy=user-gesture-required',
    '--mute-audio',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${windowSize}`,
  ];
  if (extensionDir) {
    args.push(
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`
    );
  }
  args.push('about:blank');

  const proc = Bun.spawn([CHROME_BIN, ...args], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  const cdp = await connect(port);

  const { targetId } = await cdp.send('Target.createTarget', {
    url: 'about:blank',
  });
  const { sessionId } = await cdp.send('Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  const send = (method, params) => cdp.send(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Performance.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description ||
          r.exceptionDetails.text ||
          'evaluate failed'
      );
    }
    return r.result.value;
  };

  return {
    cdp,
    send,
    evaluate,
    proc,
    async goto(url) {
      await send('Page.navigate', { url });
    },
    async close() {
      cdp.close();
      try {
        proc.kill();
      } catch {}
      const exited = await Promise.race([
        proc.exited.then(() => true).catch(() => true),
        Bun.sleep(1500).then(() => false),
      ]);
      if (!exited) {
        try {
          proc.kill('SIGKILL');
        } catch {}
        await Promise.race([proc.exited.catch(() => {}), Bun.sleep(500)]);
      }
    },
  };
}

// Waits until predicateExpr becomes truthy after navigation, avoiding the race
// where document.documentElement is still null or an execution context resets.
export async function waitForReady(evaluate, predicateExpr, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const remaining = Math.max(0, deadline - Date.now());
    if (remaining === 0) {
      try {
        return Boolean(await evaluate(`Boolean(${predicateExpr})`));
      } catch {
        return false;
      }
    }
    try {
      return await evaluate(`new Promise((resolve) => {
        const deadline = Date.now() + ${remaining};
        const ready = () => Boolean(${predicateExpr});
        if (ready()) return resolve(true);
        const attach = () => {
          if (ready()) return resolve(true);
          const left = deadline - Date.now();
          if (left <= 0) return resolve(false);
          if (!document.documentElement) {
            return setTimeout(attach, 25);
          }
          const obs = new MutationObserver(() => {
            if (ready()) { obs.disconnect(); resolve(true); }
          });
          obs.observe(document.documentElement, { childList: true, subtree: true });
          setTimeout(() => { obs.disconnect(); resolve(ready()); }, left);
        };
        attach();
      })`);
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      if (
        !/context|destroyed|navigation|target|frame|evaluate failed/i.test(
          String(err?.message || err)
        )
      )
        throw err;
      await Bun.sleep(50);
    }
  }
}

// Reads Blink's *layout tree* (distinct from DOM node count). display:none content
// keeps its DOM nodes but loses its layout boxes, so this is the honest way to
// measure "render tree reduction".
export async function captureLayoutStats(send, evaluate) {
  const snap = await send('DOMSnapshot.captureSnapshot', {
    computedStyles: [],
    includePaintOrder: false,
    includeDOMRects: false,
  });
  // Chromium's DOMSnapshot exposes layout boxes as `layout.nodeIndex`
  // (older builds used `layout.treeNodes`). Count nodes that actually
  // generate a layout box in the main frame only.
  let layoutNodes = 0;
  let frames = 0;
  for (const doc of snap.documents || []) {
    const nodes =
      doc.layout?.nodeIndex?.length ?? doc.layout?.treeNodes?.length ?? 0;
    if (nodes > 0) {
      frames++;
      layoutNodes += nodes;
    }
  }

  const domNodes = await evaluate('document.getElementsByTagName("*").length');

  const metrics = await send('Performance.getMetrics');
  const metric = (name) =>
    metrics.metrics.find((m) => m.name === name)?.value ?? 0;

  return {
    domNodes,
    layoutNodes,
    layoutFrames: frames,
    nodesMetric: metric('Nodes'),
    layoutCount: metric('LayoutCount'),
    recalcStyleCount: metric('RecalcStyleCount'),
    layoutDuration: metric('LayoutDuration'),
    recalcStyleDuration: metric('RecalcStyleDuration'),
    jsHeapUsed: metric('JSHeapUsedSize'),
    taskDuration: metric('TaskDuration'),
  };
}

// Forces synchronous style recalculation + layout by toggling a class that is
// backed by a real rule, then reading geometry back. Returns average ms per
// iteration. The same rule set is injected in both baseline and extension runs.
export async function measureForcedReflow(evaluate, iterations = 40) {
  return evaluate(`(() => {
    const html = document.documentElement;
    const style = document.createElement('style');
    style.id = 'ytlite-bench-style';
    style.textContent = '.ytlite-bench-toggle #primary { padding-left: 1px; }' +
                        '.ytlite-bench-toggle #below { margin-top: 1px; }';
    document.head.appendChild(style);

    const targets = ['#secondary', '#below', '#primary', 'ytd-watch-flexy'];
    const read = () => {
      for (const sel of targets) {
        const el = document.querySelector(sel);
        if (el) void getComputedStyle(el).display;
      }
      return html.offsetHeight;
    };

    // Warm up so first-run JIT / style-sheet insertion is not measured.
    for (let i = 0; i < 5; i++) { html.classList.toggle('ytlite-bench-toggle'); read(); }

    let sink = 0;
    const t0 = performance.now();
    for (let i = 0; i < ${iterations}; i++) {
      html.classList.toggle('ytlite-bench-toggle');
      sink += read();
    }
    const dt = performance.now() - t0;
    html.classList.remove('ytlite-bench-toggle');
    style.remove();
    return dt / ${iterations} + (sink === 0 ? 0 : 0);
  })()`);
}
