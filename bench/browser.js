// Launches headless Chrome (optionally with the unpacked extension) and returns a
// page session plus lifecycle helpers used by the benchmark.
import { connect } from './cdp.js';

const CHROME_BIN = process.env.CHROME_BIN || 'google-chrome';

export async function launchPage({ port, extensionDir = null, profileDir, windowSize = '1280,900' }) {
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
    args.push(`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`);
  }
  args.push('about:blank');

  const proc = Bun.spawn([CHROME_BIN, ...args], { stdout: 'ignore', stderr: 'ignore' });
  const cdp = await connect(port);

  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);

  await send('Page.enable');
  await send('Runtime.enable');
  await send('DOM.enable');
  await send('Performance.enable');

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
    return r.result.value;
  };

  return {
    cdp, send, evaluate, proc,
    async goto(url) { await send('Page.navigate', { url }); },
    async close() { cdp.close(); try { proc.kill(); } catch {} },
  };
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
    const nodes = doc.layout?.nodeIndex?.length ?? doc.layout?.treeNodes?.length ?? 0;
    if (nodes > 0) { frames++; layoutNodes += nodes; }
  }

  const domNodes = await evaluate('document.getElementsByTagName("*").length');

  const metrics = await send('Performance.getMetrics');
  const metric = (name) => metrics.metrics.find((m) => m.name === name)?.value ?? 0;

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
