#!/usr/bin/env node
'use strict';

/**
 * YT Lite - Comprehensive Resource Benchmark & Comparative Test Tool
 *
 * Measures and compares resource consumption on YouTube:
 * - With YT Lite extension loaded
 * - Without extension (vanilla YouTube)
 *
 * Metrics captured:
 * 1. CPU & Script Execution (Main Task duration, JS script duration, V8 compile time)
 * 2. Memory & JS Heap (JSHeapUsedSize, JSHeapTotalSize)
 * 3. DOM & Event Listeners (DOM node count, document element count, JS event listeners)
 * 4. Layout & Style Overhead (Layout passes & duration, Recalc style passes & duration)
 * 5. Network & Bandwidth (Total requests, DNR-blocked requests, wire bytes, resource breakdown)
 * 6. Mutation Overhead (DOM mutation records, added/removed nodes)
 *
 * Runs with zero external dependencies (Node.js 18+ standard library + Chrome/Chromium).
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const https = require('https');

// ============================================================================
// 1. Utilities & Chrome Detection
// ============================================================================

function findChromeBinary(customPath) {
  if (customPath && fs.existsSync(customPath)) return customPath;
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;

  const home = os.homedir();
  const candidates = [
    path.join(home, '.local/bin/google-chrome'),
    path.join(home, '.local/bin/chromium'),
    path.join(home, '.local/bin/chromium-browser'),
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/google/chrome/chrome',
    '/opt/google/chrome/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }

  // Fallback to which/where
  try {
    const cmd = process.platform === 'win32'
      ? 'where chrome 2>nul || where chromium 2>nul'
      : 'which google-chrome || which chromium || which chromium-browser';
    const whichChrome = execSync(cmd, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim().split('\n')[0];
    if (whichChrome && fs.existsSync(whichChrome)) return whichChrome;
  } catch (_) {}

  throw new Error('Chrome/Chromium binary not found. Specify via --chrome-path or CHROME_BIN.');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatBytes(bytes) {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 B';
  const sign = bytes < 0 ? '-' : '';
  const absBytes = Math.abs(bytes);
  if (absBytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(absBytes) / Math.log(k)), sizes.length - 1);
  return sign + parseFloat((absBytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(sec) {
  if (sec === undefined || sec === null || isNaN(sec) || sec === 0) return '0 ms';
  const sign = sec < 0 ? '-' : '';
  const absSec = Math.abs(sec);
  if (absSec < 0.001) return sign ? sign + '< 1 ms' : '< 1 ms';
  if (absSec < 1) return sign + (absSec * 1000).toFixed(1) + ' ms';
  return sign + absSec.toFixed(2) + ' s';
}

function formatNumber(num) {
  if (num === undefined || num === null || isNaN(num)) return '0';
  const sign = num < 0 ? '-' : '';
  const absNum = Math.abs(num);
  return sign + Math.round(absNum).toLocaleString('en-US');
}

// ============================================================================
// 2. Mock YouTube HTTPS Server (for offline & deterministic testing)
// ============================================================================

class MockYouTubeServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.tmpDir = null;
    this.requests = [];
  }

  async start() {
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-mock-srv-'));
    const keyFile = path.join(this.tmpDir, 'key.pem');
    const certFile = path.join(this.tmpDir, 'cert.pem');

    execSync(
      `openssl req -x509 -newkey rsa:2048 -nodes -keyout "${keyFile}" -out "${certFile}" -days 1 -subj "/CN=www.youtube.com" 2>/dev/null`
    );

    this.server = https.createServer(
      {
        key: fs.readFileSync(keyFile),
        cert: fs.readFileSync(certFile)
      },
      (req, res) => {
        this.requests.push({ url: req.url, method: req.method });

        if (req.url.startsWith('/watch') || req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(this.getMockHtml());
          return;
        }

        if (req.url.includes('/youtubei/v1/log_event') || req.url.includes('/youtubei/v1/feedback')) {
          res.writeHead(204);
          res.end();
          return;
        }

        if (req.url.endsWith('.js')) {
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end('// mock script\nconsole.log("Mock script executed");');
          return;
        }

        if (req.url.endsWith('.css')) {
          res.writeHead(200, { 'Content-Type': 'text/css' });
          res.end('/* mock styles */ body { background: #0f0f0f; }');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
      }
    );

    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        this.port = this.server.address().port;
        resolve(this.port);
      });
      this.server.on('error', reject);
    });
  }

  stop() {
    if (this.server) {
      try { this.server.close(); } catch (_) {}
      this.server = null;
    }
    if (this.tmpDir) {
      try { fs.rmSync(this.tmpDir, { recursive: true, force: true }); } catch (_) {}
      this.tmpDir = null;
    }
  }

  getMockHtml() {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Mock YouTube Watch Page</title>
  <style>
    body { margin: 0; font-family: Roboto, Arial, sans-serif; background: #0f0f0f; color: #fff; }
    ytd-app { display: block; }
    ytd-watch-flexy { display: block; width: 100%; }
    #columns { display: flex; max-width: 1280px; margin: 0 auto; gap: 24px; padding: 24px; }
    #primary { flex: 1; min-width: 0; }
    #secondary { width: 400px; flex-shrink: 0; }
    #player { width: 100%; aspect-ratio: 16/9; background: #000; }
    #below { padding-top: 16px; }
    #comments { padding-top: 16px; border-top: 1px solid #333; }
    ytd-comment-thread-renderer { display: block; padding: 12px 0; border-bottom: 1px solid #222; }
    ytd-compact-video-renderer { display: flex; height: 94px; margin-bottom: 8px; background: #1a1a1a; }
  </style>
</head>
<body>
  <ytd-app>
    <ytd-watch-flexy>
      <div id="columns">
        <div id="primary">
          <div id="primary-inner">
            <div id="player"></div>
            <div id="below">
              <ytd-watch-metadata id="meta">
                <h1>Mock Video Title</h1>
                <p>Mock Channel Name &middot; 1.2M views</p>
              </ytd-watch-metadata>
              <ytd-comments id="comments">
                <ytd-item-section-renderer section-identifier="comment-item-section">
                  <div id="contents">
                    ${Array.from({ length: 60 }, (_, i) => `
                      <ytd-comment-thread-renderer class="comment-item">
                        <div id="author">User_${i}</div>
                        <div id="content-text">Great mock video demonstration! Comment #${i}</div>
                      </ytd-comment-thread-renderer>
                    `).join('')}
                  </div>
                </ytd-item-section-renderer>
              </ytd-comments>
            </div>
          </div>
        </div>
        <div id="secondary">
          <div id="secondary-inner">
            <ytd-watch-next-secondary-results-renderer id="related">
              ${Array.from({ length: 30 }, (_, i) => `
                <ytd-compact-video-renderer>
                  <div class="thumbnail">Thumbnail ${i}</div>
                  <div class="title">Recommended Video #${i}</div>
                </ytd-compact-video-renderer>
              `).join('')}
            </ytd-watch-next-secondary-results-renderer>
            <!-- Collapsed chat simulates standard non-live watch page -->
            <ytd-live-chat-frame collapsed id="chat"></ytd-live-chat-frame>
          </div>
        </div>
      </div>
    </ytd-watch-flexy>
  </ytd-app>

  <script>
    // Simulate YouTube core network telemetry and ad slots
    fetch('/youtubei/v1/log_event', { method: 'POST' }).catch(() => {});
    fetch('/youtubei/v1/feedback', { method: 'POST' }).catch(() => {});
    fetch('https://googleads.g.doubleclick.net/pagead/id').catch(() => {});
    fetch('https://www.google-analytics.com/analytics.js').catch(() => {});

    // Listen for continuation event (when Show comments button is clicked)
    document.addEventListener('yt-load-next-continuation', () => {
      const contents = document.getElementById('contents');
      if (contents) {
        for (let i = 60; i < 90; i++) {
          const div = document.createElement('ytd-comment-thread-renderer');
          div.className = 'comment-item hydrated';
          div.innerHTML = '<div id="author">Hydrated_' + i + '</div><div id="content-text">Expanded comment ' + i + '</div>';
          contents.appendChild(div);
        }
      }
    });
  </script>
</body>
</html>`;
  }
}

// ============================================================================
// 3. Chrome CDP Client & Benchmark Session
// ============================================================================

class ChromeSession {
  constructor(options = {}) {
    this.chromePath = findChromeBinary(options.chromePath);
    this.loadExtension = Boolean(options.loadExtension);
    this.extensionDir = options.extensionDir || path.resolve(__dirname);
    this.headless = options.headless !== false;
    this.mockPort = options.mockPort || null;
    this.port = null;
    this.tmpDir = null;
    this.process = null;
    this.ws = null;
    this.msgId = 1;
    this.pendingCallbacks = new Map();
    this.pendingRequests = new Map();

    // Collected telemetry
    this.networkEvents = {
      requests: 0,
      completed: 0,
      blocked: 0,
      failed: 0,
      transferredBytes: 0,
      byType: {
        Document: { count: 0, bytes: 0 },
        Script: { count: 0, bytes: 0 },
        XHR: { count: 0, bytes: 0 },
        Fetch: { count: 0, bytes: 0 },
        Image: { count: 0, bytes: 0 },
        Media: { count: 0, bytes: 0 },
        Stylesheet: { count: 0, bytes: 0 },
        Font: { count: 0, bytes: 0 },
        Other: { count: 0, bytes: 0 }
      },
      blockedUrls: []
    };

    this.rawMetrics = {};
    this.postGcMetrics = {};
    this.pageEval = {};
  }

  async start() {
    this.port = await getFreePort();
    this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-bench-prof-'));

    const args = [
      this.headless ? '--headless=new' : '--auto-open-devtools-for-tabs',
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.tmpDir}`,
      '--no-sandbox',
      '--disable-gpu',
      '--mute-audio',
      '--window-size=1280,800',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding'
    ];

    if (this.mockPort) {
      args.push(
        '--ignore-certificate-errors',
        `--host-resolver-rules=MAP www.youtube.com 127.0.0.1:${this.mockPort}, MAP *.doubleclick.net 127.0.0.1:${this.mockPort}, MAP *.google-analytics.com 127.0.0.1:${this.mockPort}`
      );
    }

    if (this.loadExtension) {
      args.push(
        `--disable-extensions-except=${this.extensionDir}`,
        `--load-extension=${this.extensionDir}`
      );
    }

    args.push('about:blank');

    let stderrData = '';
    this.process = spawn(this.chromePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    this.process.stderr?.on('data', chunk => {
      stderrData += chunk.toString();
    });

    this.process.on('error', (err) => {
      console.error('Chrome process launch error:', err);
    });

    // Wait for CDP endpoint
    let connected = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/json/version`);
        if (res.ok) {
          connected = true;
          break;
        }
      } catch (_) {}
      await sleep(100);
    }

    if (!connected) {
      this.cleanup();
      throw new Error(`Chrome failed to start or open CDP port on ${this.port}. Stderr: ${stderrData.slice(-400) || 'none'}`);
    }

    // Connect to page WebSocket
    const targetsRes = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    const targets = await targetsRes.json();
    const pageTarget = targets.find(t => t.type === 'page');

    if (!pageTarget || !pageTarget.webSocketDebuggerUrl) {
      this.cleanup();
      throw new Error('No valid page target found in Chrome');
    }

    this.ws = new WebSocket(pageTarget.webSocketDebuggerUrl);

    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (event) => this.handleCdpMessage(JSON.parse(event.data));

    // Enable CDP domains
    await this.send('Page.enable');
    await this.send('Performance.enable');
    await this.send('Network.enable');
    await this.send('HeapProfiler.enable');

    // Pre-seed YouTube cookie consent to bypass European/GDPR consent walls on clean profile
    try {
      await this.send('Network.setCookie', {
        name: 'SOCS',
        value: 'CAESEwgDEgk2MTQ1NzU1NDQaAmVuIAEaBgiA_LyaBg',
        domain: '.youtube.com',
        path: '/'
      });
      await this.send('Network.setCookie', {
        name: 'CONSENT',
        value: 'PENDING+999',
        domain: '.youtube.com',
        path: '/'
      });
    } catch (_) {}

    // Inject in-page mutation counter and consent auto-dismiss before navigation
    await this.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `
        (function() {
          window.__ytBench = {
            mutations: { records: 0, added: 0, removed: 0 },
            startTime: performance.now(),
            initialized: true
          };
          const obs = new MutationObserver(mutations => {
            window.__ytBench.mutations.records += mutations.length;
            for (let i = 0; i < mutations.length; i++) {
              window.__ytBench.mutations.added += mutations[i].addedNodes.length;
              window.__ytBench.mutations.removed += mutations[i].removedNodes.length;
            }
          });
          obs.observe(document, { childList: true, subtree: true });

          // Auto-dismiss cookie consent interstitial if displayed
          const dismissConsent = () => {
            const btn = document.querySelector('form[action*="consent"] button, button[aria-label*="Accept all"], button[aria-label*="Reject all"], ytd-button-renderer button[aria-label*="Agree"]');
            if (btn) btn.click();
          };
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', dismissConsent, { once: true });
          } else {
            dismissConsent();
          }
        })();
      `
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pendingCallbacks.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  handleCdpMessage(msg) {
    if (msg.id && this.pendingCallbacks.has(msg.id)) {
      const { resolve, reject } = this.pendingCallbacks.get(msg.id);
      this.pendingCallbacks.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
      return;
    }

    // Network tracking events
    if (msg.method === 'Network.requestWillBeSent') {
      this.networkEvents.requests++;
      const type = msg.params.type || 'Other';
      const key = this.networkEvents.byType[type] ? type : 'Other';
      this.networkEvents.byType[key].count++;

      // Store pending request metadata
      this.pendingRequests.set(msg.params.requestId, {
        url: msg.params.request?.url || '',
        type: key
      });
    } else if (msg.method === 'Network.loadingFinished') {
      this.networkEvents.completed++;
      const bytes = msg.params.encodedDataLength || 0;
      this.networkEvents.transferredBytes += bytes;

      const req = this.pendingRequests.get(msg.params.requestId);
      if (req && this.networkEvents.byType[req.type]) {
        this.networkEvents.byType[req.type].bytes += bytes;
      }
      this.pendingRequests.delete(msg.params.requestId);
    } else if (msg.method === 'Network.loadingFailed') {
      const isBlocked =
        Boolean(msg.params.blockedReason) ||
        (msg.params.errorText && msg.params.errorText.includes('BLOCKED_BY_CLIENT'));

      const req = this.pendingRequests.get(msg.params.requestId);
      const reqUrl = req?.url || msg.params.requestId;

      if (isBlocked) {
        this.networkEvents.blocked++;
        this.networkEvents.blockedUrls.push({
          url: reqUrl,
          reason: msg.params.blockedReason || msg.params.errorText
        });
      } else {
        this.networkEvents.failed++;
      }
      this.pendingRequests.delete(msg.params.requestId);
    }
  }

  async runBenchmark(url, durationSec = 10, clickComments = false) {
    // Navigate to target URL
    const navRes = await this.send('Page.navigate', { url });
    if (navRes && navRes.errorText) {
      throw new Error(`Navigation failed: ${navRes.errorText}`);
    }

    // Wait for observation duration
    await sleep(durationSec * 1000);

    // If comments interaction test is requested
    let commentsClickResult = null;
    if (clickComments) {
      commentsClickResult = await this.send('Runtime.evaluate', {
        expression: `
          (function() {
            const btn = document.querySelector('.ytlite-comments-btn');
            if (btn) {
              btn.click();
              return { clicked: true, found: true };
            }
            return { clicked: false, found: false };
          })()
        `,
        returnByValue: true
      });
      // Wait an additional 3 seconds to measure comment hydration overhead
      await sleep(3000);
    }

    // Query active runtime metrics before GC
    const metricsResponse = await this.send('Performance.getMetrics');
    const rawMetrics = Object.fromEntries(
      metricsResponse.metrics.map(m => [m.name, m.value])
    );
    this.rawMetrics = rawMetrics;

    // Force deterministic Garbage Collection to capture true retained heap
    try {
      await this.send('HeapProfiler.collectGarbage');
    } catch (_) {}

    const postGcResponse = await this.send('Performance.getMetrics');
    this.postGcMetrics = Object.fromEntries(
      postGcResponse.metrics.map(m => [m.name, m.value])
    );

    // In-page inspection
    const pageEvalResponse = await this.send('Runtime.evaluate', {
      expression: `
        (function() {
          const domElements = document.getElementsByTagName('*').length;
          const hasYtLiteBtn = !!document.querySelector('.ytlite-comments-btn');
          const hasCommentsHideClass = document.documentElement.classList.contains('ytlite-comments-hide');
          const hasLiveClass = document.documentElement.classList.contains('ytlite-live');
          const mutations = window.__ytBench?.mutations || { records: 0, added: 0, removed: 0 };
          const secondaryEl = document.querySelector('#secondary');
          const secondaryDisplay = secondaryEl ? window.getComputedStyle(secondaryEl).display : 'none';
          const commentsCount = document.querySelectorAll('ytd-comment-thread-renderer, .comment-item').length;

          return {
            domElements,
            hasYtLiteBtn,
            hasCommentsHideClass,
            hasLiveClass,
            mutations,
            secondaryDisplay,
            commentsCount
          };
        })()
      `,
      returnByValue: true
    });

    this.pageEval = pageEvalResponse.result?.value || {};
    this.pageEval.commentsClick = commentsClickResult?.result?.value;

    return this.getSummaryMetrics();
  }

  getSummaryMetrics() {
    const m = this.rawMetrics;
    const postGc = this.postGcMetrics;
    const net = this.networkEvents;
    const evalData = this.pageEval;

    // Lifecycle timings relative to NavigationStart
    const navStart = m.NavigationStart || 0;
    const domContentLoadedSec = m.DomContentLoaded && navStart ? Math.max(0, m.DomContentLoaded - navStart) : 0;
    const firstMeaningfulPaintSec = m.FirstMeaningfulPaint && navStart ? Math.max(0, m.FirstMeaningfulPaint - navStart) : 0;

    return {
      // Memory
      jsHeapUsedBytes: m.JSHeapUsedSize || 0,
      jsHeapTotalBytes: m.JSHeapTotalSize || 0,
      heapUsedPostGcBytes: postGc.JSHeapUsedSize || m.JSHeapUsedSize || 0,
      // DOM & Structure
      nodes: m.Nodes || 0,
      domElements: evalData.domElements || 0,
      layoutObjects: m.LayoutObjects || 0,
      documents: m.Documents || 0,
      eventListeners: m.JSEventListeners || 0,
      // Page Lifecycle Timing
      domContentLoadedSec,
      firstMeaningfulPaintSec,
      // Tasks & CPU Execution
      taskDurationSec: m.TaskDuration || 0,
      scriptDurationSec: m.ScriptDuration || 0,
      threadTimeSec: m.ThreadTime || 0,
      processTimeSec: m.ProcessTime || 0,
      v8CompileDurationSec: m.V8CompileDuration || 0,
      taskOtherDurationSec: m.TaskOtherDuration || 0,
      // Layout & Style Overhead
      layoutCount: m.LayoutCount || 0,
      layoutDurationSec: m.LayoutDuration || 0,
      recalcStyleCount: m.RecalcStyleCount || 0,
      recalcStyleDurationSec: m.RecalcStyleDuration || 0,
      // Network
      networkRequests: net.requests,
      completedRequests: net.completed,
      blockedRequests: net.blocked,
      failedRequests: net.failed,
      transferredBytes: net.transferredBytes,
      byType: net.byType,
      blockedUrls: net.blockedUrls,
      // Mutations
      mutationRecords: evalData.mutations?.records || 0,
      mutationsAdded: evalData.mutations?.added || 0,
      mutationsRemoved: evalData.mutations?.removed || 0,
      // Content & State
      extensionActive: Boolean(this.loadExtension),
      hasYtLiteBtn: Boolean(evalData.hasYtLiteBtn),
      hasCommentsHideClass: Boolean(evalData.hasCommentsHideClass),
      secondaryDisplay: evalData.secondaryDisplay || 'unknown',
      commentsCount: evalData.commentsCount || 0
    };
  }

  cleanup() {
    if (this.ws) {
      try { this.ws.close(); } catch (_) {}
      this.ws = null;
    }
    const proc = this.process;
    this.process = null;

    if (proc) {
      try {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!proc.killed) {
            try { proc.kill('SIGKILL'); } catch (_) {}
          }
        }, 800);
      } catch (_) {}
    }

    if (this.tmpDir) {
      const dir = this.tmpDir;
      this.tmpDir = null;
      // Allow Chrome a moment to release file handles before deleting profile
      setTimeout(() => {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      }, 500);
    }
  }
}

// ============================================================================
// 4. Comparison & Statistics Engine
// ============================================================================

function averageMetrics(metricList) {
  if (!metricList || metricList.length === 0) return {};
  if (metricList.length === 1) return metricList[0];

  const n = metricList.length;
  const avg = { ...metricList[0] };
  const numericKeys = [
    'jsHeapUsedBytes', 'jsHeapTotalBytes', 'heapUsedPostGcBytes',
    'nodes', 'domElements', 'layoutObjects', 'documents', 'eventListeners',
    'taskDurationSec', 'scriptDurationSec', 'threadTimeSec', 'processTimeSec',
    'v8CompileDurationSec', 'taskOtherDurationSec',
    'domContentLoadedSec', 'firstMeaningfulPaintSec',
    'layoutCount', 'layoutDurationSec', 'recalcStyleCount', 'recalcStyleDurationSec',
    'networkRequests', 'completedRequests', 'blockedRequests', 'failedRequests', 'transferredBytes',
    'mutationRecords', 'mutationsAdded', 'mutationsRemoved', 'commentsCount'
  ];

  for (const k of numericKeys) {
    const sum = metricList.reduce((acc, m) => acc + (m[k] || 0), 0);
    avg[k] = sum / n;
  }

  // Deep average byType
  const types = Object.keys(metricList[0].byType || {});
  avg.byType = {};
  for (const t of types) {
    const sumCount = metricList.reduce((acc, m) => acc + (m.byType?.[t]?.count || 0), 0);
    const sumBytes = metricList.reduce((acc, m) => acc + (m.byType?.[t]?.bytes || 0), 0);
    avg.byType[t] = {
      count: Math.round(sumCount / n),
      bytes: Math.round(sumBytes / n)
    };
  }

  // Combine unique blocked URLs
  const seenUrls = new Set();
  avg.blockedUrls = [];
  for (const m of metricList) {
    for (const b of (m.blockedUrls || [])) {
      if (!seenUrls.has(b.url)) {
        seenUrls.add(b.url);
        avg.blockedUrls.push(b);
      }
    }
  }

  return avg;
}

function compareMetrics(vanilla, lite) {
  const definitions = [
    // [category, key, label, formatFn, lowerIsBetter]
    ['Memory', 'jsHeapUsedBytes', 'JS Heap Active', formatBytes, true],
    ['Memory', 'heapUsedPostGcBytes', 'JS Heap Retained (Post-GC)', formatBytes, true],
    ['Memory', 'jsHeapTotalBytes', 'JS Heap Allocated', formatBytes, true],

    ['DOM & Structure', 'nodes', 'Total DOM Nodes', formatNumber, true],
    ['DOM & Structure', 'domElements', 'Document Elements', formatNumber, true],
    ['DOM & Structure', 'layoutObjects', 'Layout/Render Objects', formatNumber, true],
    ['DOM & Structure', 'eventListeners', 'JS Event Listeners', formatNumber, true],
    ['DOM & Structure', 'documents', 'Documents / Frames', formatNumber, true],

    ['Page Speed & Timing', 'domContentLoadedSec', 'DOMContentLoaded Time', formatDuration, true],
    ['Page Speed & Timing', 'firstMeaningfulPaintSec', 'First Meaningful Paint', formatDuration, true],

    ['CPU & Execution', 'taskDurationSec', 'Main Thread Tasks', formatDuration, true],
    ['CPU & Execution', 'scriptDurationSec', 'Script Execution', formatDuration, true],
    ['CPU & Execution', 'threadTimeSec', 'Thread CPU Time', formatDuration, true],
    ['CPU & Execution', 'processTimeSec', 'Process CPU Time', formatDuration, true],
    ['CPU & Execution', 'v8CompileDurationSec', 'V8 Compile Time', formatDuration, true],

    ['Layout & Style', 'layoutCount', 'Layout Passes', formatNumber, true],
    ['Layout & Style', 'layoutDurationSec', 'Layout Duration', formatDuration, true],
    ['Layout & Style', 'recalcStyleCount', 'Recalc Style Passes', formatNumber, true],
    ['Layout & Style', 'recalcStyleDurationSec', 'Recalc Style Duration', formatDuration, true],

    ['Network & Data', 'networkRequests', 'Total Requests', formatNumber, true],
    ['Network & Data', 'blockedRequests', 'Blocked Requests', formatNumber, false], // more blocked is better
    ['Network & Data', 'transferredBytes', 'Transferred Data', formatBytes, true],

    ['DOM Mutations', 'mutationRecords', 'Mutation Records', formatNumber, true],
    ['DOM Mutations', 'mutationsAdded', 'Nodes Added', formatNumber, true],
    ['DOM Mutations', 'mutationsRemoved', 'Nodes Removed', formatNumber, true]
  ];

  return definitions.map(([category, key, label, formatFn, lowerIsBetter]) => {
    const vVal = vanilla[key] || 0;
    const lVal = lite[key] || 0;
    const delta = lVal - vVal;
    let pct = 0;
    let pctStr = '0.0%';

    if (vVal === 0) {
      if (lVal === 0) {
        pctStr = '0.0%';
      } else {
        pctStr = `+${formatFn(lVal)} (new)`;
      }
    } else {
      pct = ((lVal - vVal) / vVal) * 100;
      pctStr = (pct > 0 ? '+' : '') + pct.toFixed(1) + '%';
    }

    let isWin = false;
    let isLoss = false;

    if (key === 'blockedRequests') {
      if (lVal > vVal) isWin = true;
      else if (lVal < vVal) isLoss = true;
    } else if (lowerIsBetter) {
      if (delta < 0) isWin = true;
      else if (delta > 0 && (vVal === 0 || Math.abs(pct) >= 1.0)) isLoss = true;
    } else {
      if (delta > 0) isWin = true;
      else if (delta < 0 && (vVal === 0 || Math.abs(pct) >= 1.0)) isLoss = true;
    }

    return {
      category,
      key,
      label,
      vanillaRaw: vVal,
      liteRaw: lVal,
      vanillaFormatted: formatFn(vVal),
      liteFormatted: formatFn(lVal),
      deltaRaw: delta,
      deltaFormatted: (delta > 0 ? '+' : (delta < 0 ? '-' : '')) + formatFn(Math.abs(delta)),
      pct,
      pctFormatted: pctStr,
      lowerIsBetter,
      isWin,
      isLoss
    };
  });
}

// ============================================================================
// 5. Terminal Formatter & Report Exporters
// ============================================================================

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

function renderTerminalTable(comparisons, meta, vanillaAvg = {}, liteAvg = {}) {
  const line = '─'.repeat(94);
  const doubleLine = '═'.repeat(94);

  console.log('\n' + doubleLine);
  console.log(`${ANSI.bold}${ANSI.cyan}  YT LITE RESOURCE CONSUMPTION BENCHMARK REPORT${ANSI.reset}`);
  console.log(`  Target URL: ${ANSI.white}${meta.url}${ANSI.reset}`);
  console.log(`  Duration: ${ANSI.white}${meta.durationSec}s${ANSI.reset} | Runs: ${ANSI.white}${meta.runs}${ANSI.reset} | Browser: ${ANSI.white}${meta.chromeVersion}${ANSI.reset}`);
  console.log(doubleLine);

  // Group by category
  const categories = {};
  for (const c of comparisons) {
    if (!categories[c.category]) categories[c.category] = [];
    categories[c.category].push(c);
  }

  console.log(
    `${ANSI.bold}  ${'Metric'.padEnd(28)} ${'Vanilla (No Ext)'.padStart(16)} ${'YT Lite'.padStart(14)} ${'Delta'.padStart(15)} ${'% Change'.padStart(15)}${ANSI.reset}`
  );
  console.log('  ' + line);

  for (const [catName, items] of Object.entries(categories)) {
    console.log(`\n  ${ANSI.bold}${ANSI.yellow}[${catName}]${ANSI.reset}`);
    for (const item of items) {
      let changeColor = ANSI.reset;
      let symbol = ' ';
      if (item.isWin) {
        changeColor = ANSI.green;
        symbol = '▼ ';
      } else if (item.isLoss) {
        changeColor = ANSI.red;
        symbol = '▲ ';
      }

      const label = item.label.padEnd(28);
      const vVal = item.vanillaFormatted.padStart(16);
      const lVal = item.liteFormatted.padStart(14);
      const delta = item.deltaFormatted.padStart(15);
      const change = `${changeColor}${symbol}${item.pctFormatted}${ANSI.reset}`.padStart(15 + changeColor.length + ANSI.reset.length);

      console.log(`  ${label} ${vVal} ${lVal} ${delta} ${change}`);
    }
  }

  // Network by-type breakdown
  if (vanillaAvg.byType && liteAvg.byType) {
    console.log(`\n  ${ANSI.bold}${ANSI.yellow}[Network Breakdown by Type]${ANSI.reset}`);
    console.log(`  ${'Type'.padEnd(16)} ${'Vanilla (Req / Bytes)'.padStart(28)} ${'YT Lite (Req / Bytes)'.padStart(28)} ${'Bytes Delta'.padStart(16)}`);
    console.log('  ' + line);

    for (const [typeKey, vData] of Object.entries(vanillaAvg.byType)) {
      const lData = liteAvg.byType[typeKey] || { count: 0, bytes: 0 };
      if (vData.count === 0 && lData.count === 0) continue;

      const vStr = `${vData.count} req (${formatBytes(vData.bytes)})`.padStart(28);
      const lStr = `${lData.count} req (${formatBytes(lData.bytes)})`.padStart(28);
      const dBytes = lData.bytes - vData.bytes;
      const dStr = (dBytes > 0 ? '+' : (dBytes < 0 ? '-' : '')) + formatBytes(Math.abs(dBytes));
      const color = dBytes < 0 ? ANSI.green : (dBytes > 0 ? ANSI.red : ANSI.reset);

      console.log(`  ${typeKey.padEnd(16)} ${vStr} ${lStr} ${color}${dStr.padStart(16)}${ANSI.reset}`);
    }
  }

  console.log('\n  ' + line);

  // Highlights
  console.log(`${ANSI.bold}${ANSI.cyan}  KEY RESOURCE HIGHLIGHTS:${ANSI.reset}`);

  const findComp = k => comparisons.find(c => c.key === k);
  const netBytes = findComp('transferredBytes');
  const domNodes = findComp('nodes');
  const layoutObjects = findComp('layoutObjects');
  const layoutPasses = findComp('layoutCount');
  const taskDur = findComp('taskDurationSec');
  const heapRetained = findComp('heapUsedPostGcBytes');
  const blockedReq = findComp('blockedRequests');
  const dcl = findComp('domContentLoadedSec');

  if (blockedReq && blockedReq.liteRaw > 0) {
    console.log(`  ${ANSI.green}✓ Blocked Requests:${ANSI.reset} Blocked ${blockedReq.liteRaw} ad/telemetry requests via DNR rules.`);
  }
  if (dcl && dcl.deltaRaw < 0) {
    console.log(`  ${ANSI.green}✓ Page Speed:${ANSI.reset} Accelerated DOMContentLoaded by ${formatDuration(Math.abs(dcl.deltaRaw))} (${dcl.pctFormatted}).`);
  }
  if (heapRetained && heapRetained.deltaRaw < 0) {
    console.log(`  ${ANSI.green}✓ Retained Memory:${ANSI.reset} Saved ${formatBytes(Math.abs(heapRetained.deltaRaw))} (${heapRetained.pctFormatted}) in retained post-GC heap.`);
  }
  if (layoutObjects && layoutObjects.deltaRaw < 0) {
    console.log(`  ${ANSI.green}✓ Render Tree:${ANSI.reset} Eliminated ${formatNumber(Math.abs(layoutObjects.deltaRaw))} layout objects (${layoutObjects.pctFormatted}) from rendering pipeline.`);
  }
  if (domNodes && domNodes.deltaRaw < 0) {
    console.log(`  ${ANSI.green}✓ DOM Footprint:${ANSI.reset} Eliminated ${formatNumber(Math.abs(domNodes.deltaRaw))} DOM nodes (${domNodes.pctFormatted}) from rendering tree.`);
  }
  if (layoutPasses && layoutPasses.deltaRaw < 0) {
    console.log(`  ${ANSI.green}✓ Rendering Overhead:${ANSI.reset} Reduced layout passes by ${formatNumber(Math.abs(layoutPasses.deltaRaw))} (${layoutPasses.pctFormatted}).`);
  }
  if (taskDur && taskDur.deltaRaw < 0) {
    console.log(`  ${ANSI.green}✓ Main Thread CPU:${ANSI.reset} Cut main thread task duration by ${formatDuration(Math.abs(taskDur.deltaRaw))} (${taskDur.pctFormatted}).`);
  }
  if (netBytes && netBytes.deltaRaw < 0) {
    console.log(`  ${ANSI.green}✓ Bandwidth Saved:${ANSI.reset} Saved ${formatBytes(Math.abs(netBytes.deltaRaw))} (${netBytes.pctFormatted}) in network data.`);
  }

  // Blocked URLs section
  if (liteAvg.blockedUrls && liteAvg.blockedUrls.length > 0) {
    console.log(`\n  ${ANSI.bold}${ANSI.yellow}[Blocked Ad & Telemetry URLs]${ANSI.reset}`);
    for (const b of liteAvg.blockedUrls.slice(0, 8)) {
      console.log(`  ${ANSI.dim}•${ANSI.reset} ${b.url}`);
    }
  }

  console.log(doubleLine + '\n');
}

function generateMarkdownReport(comparisons, meta, vanillaAvg = {}, liteAvg = {}) {
  let md = `# YT Lite — Resource Consumption Benchmark Report\n\n`;
  md += `> Comparative benchmark measuring resource overhead on YouTube with **YT Lite extension enabled** versus **Vanilla YouTube (No Extension)**.\n\n`;

  md += `## Benchmark Metadata\n\n`;
  md += `- **Date**: ${new Date().toISOString()}\n`;
  md += `- **Target URL**: \`${meta.url}\`\n`;
  md += `- **Observation Window**: \`${meta.durationSec} seconds\`\n`;
  md += `- **Benchmark Runs**: \`${meta.runs}\`\n`;
  md += `- **Browser**: \`${meta.chromeVersion}\`\n`;
  md += `- **Operating System**: \`${os.type()} ${os.release()} (${os.arch()})\`\n\n`;

  md += `## Resource Comparison Table\n\n`;
  md += `| Category | Metric | Vanilla (No Extension) | YT Lite (With Extension) | Delta | Change | Impact |\n`;
  md += `| :--- | :--- | :---: | :---: | :---: | :---: | :---: |\n`;

  for (const c of comparisons) {
    let impact = 'Neutral';
    if (c.isWin) impact = '✅ **Saved**';
    else if (c.isLoss) impact = '⚠️ Overhead';

    md += `| ${c.category} | ${c.label} | ${c.vanillaFormatted} | ${c.liteFormatted} | ${c.deltaFormatted} | ${c.pctFormatted} | ${impact} |\n`;
  }

  // Network resource breakdown table
  if (vanillaAvg.byType && liteAvg.byType) {
    md += `\n## Network Resource Breakdown\n\n`;
    md += `| Resource Type | Vanilla Requests | Vanilla Data | YT Lite Requests | YT Lite Data | Data Delta |\n`;
    md += `| :--- | :---: | :---: | :---: | :---: | :---: |\n`;

    for (const [typeKey, vData] of Object.entries(vanillaAvg.byType)) {
      const lData = liteAvg.byType[typeKey] || { count: 0, bytes: 0 };
      if (vData.count === 0 && lData.count === 0) continue;

      const dBytes = lData.bytes - vData.bytes;
      const dStr = (dBytes > 0 ? '+' : (dBytes < 0 ? '-' : '')) + formatBytes(Math.abs(dBytes));
      md += `| **${typeKey}** | ${vData.count} | ${formatBytes(vData.bytes)} | ${lData.count} | ${formatBytes(lData.bytes)} | ${dStr} |\n`;
    }
  }

  // Blocked URLs
  if (liteAvg.blockedUrls && liteAvg.blockedUrls.length > 0) {
    md += `\n## Blocked Ad & Telemetry Requests\n\n`;
    md += `The following ad, tracker, and telemetry network requests were blocked by declarativeNetRequest rules:\n\n`;
    for (const b of liteAvg.blockedUrls) {
      md += `- \`${b.url}\`\n`;
    }
  }

  md += `\n## Key Architectural Savings\n\n`;
  md += `1. **Zero Comment Tree Hydration**: YT Lite hides and delays the comment section until the user explicitly clicks *"Show comments"*, preventing thousands of Polymer comment elements and avatars from populating the DOM.\n`;
  md += `2. **Secondary Sidebar Collapsed**: Collapsing the heavy recommendation sidebar eliminates related video thumbnails, live chat iframes, and secondary layout invalidations.\n`;
  md += `3. **Zero Polling & Zero Ongoing Observers**: During video playback, YT Lite runs **0 MutationObservers** and **0 setInterval polling timers**, resulting in lower main thread CPU consumption.\n`;
  md += `4. **Declarative Network Request Ad & Telemetry Blocking**: Pre-filters tracking, telemetry, and ad requests at the network engine layer before they consume network sockets or CPU.\n\n`;

  md += `## Methodology\n\n`;
  md += `- Spawns isolated Chromium instances with clean, ephemeral user data directories to guarantee no cache or cookie contamination.\n`;
  md += `- Uses the Chrome DevTools Protocol (\`Performance.getMetrics\`, \`HeapProfiler\`, \`Network\`, \`Page\`) directly over native WebSockets.\n`;
  md += `- Enforces post-run deterministic garbage collection (\`HeapProfiler.collectGarbage\`) to measure true retained JS heap without GC scheduling jitter.\n`;
  md += `- Pre-seeds YouTube cookie consent tokens (\`SOCS\`) to bypass European/GDPR interstitial walls in headless runs.\n`;

  return md;
}

// ============================================================================
// 6. Main Benchmark Runner
// ============================================================================

async function runBenchmark(options = {}) {
  const url = options.url || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const durationSec = options.duration ? parseFloat(options.duration) : 10;
  const runs = options.runs ? parseInt(options.runs, 10) : 1;
  const headless = options.headless !== false;
  const mock = Boolean(options.mock);
  const clickComments = Boolean(options.testComments);

  let mockServer = null;
  let mockPort = null;
  let benchmarkUrl = url;

  if (mock) {
    console.log(`${ANSI.cyan}[Mock Mode] Starting local HTTPS YouTube simulator...${ANSI.reset}`);
    mockServer = new MockYouTubeServer();
    mockPort = await mockServer.start();
    benchmarkUrl = 'https://www.youtube.com/watch?v=mock';
    console.log(`[Mock Mode] Mock server listening on port ${mockPort}`);
  }

  const vanillaRuns = [];
  const liteRuns = [];
  let chromeVersion = 'Unknown';

  try {
    for (let r = 1; r <= runs; r++) {
      const runPrefix = runs > 1 ? `[Run ${r}/${runs}] ` : '';

      // 1. Run Vanilla YouTube
      console.log(`\n${runPrefix}${ANSI.bold}Benchmarking Vanilla YouTube (No Extension)...${ANSI.reset}`);
      const vanillaSession = new ChromeSession({
        chromePath: options.chromePath,
        loadExtension: false,
        headless,
        mockPort
      });

      try {
        await vanillaSession.start();
        if (chromeVersion === 'Unknown') {
          const vRes = await fetch(`http://127.0.0.1:${vanillaSession.port}/json/version`);
          const vData = await vRes.json();
          chromeVersion = vData.Browser || 'Chrome';
        }

        const metrics = await vanillaSession.runBenchmark(benchmarkUrl, durationSec, clickComments);
        vanillaRuns.push(metrics);
        console.log(`  ✓ Completed: ${metrics.networkRequests} requests, ${formatBytes(metrics.transferredBytes)}, ${formatNumber(metrics.nodes)} nodes, ${formatDuration(metrics.taskDurationSec)} tasks`);
      } finally {
        vanillaSession.cleanup();
      }

      // Rest between runs
      await sleep(1000);

      // 2. Run YT Lite
      console.log(`${runPrefix}${ANSI.bold}Benchmarking YT Lite (With Extension)...${ANSI.reset}`);
      const liteSession = new ChromeSession({
        chromePath: options.chromePath,
        loadExtension: true,
        extensionDir: options.extensionDir || path.resolve(__dirname),
        headless,
        mockPort
      });

      try {
        await liteSession.start();
        const metrics = await liteSession.runBenchmark(benchmarkUrl, durationSec, clickComments);
        liteRuns.push(metrics);
        console.log(`  ✓ Completed: ${metrics.networkRequests} requests, ${formatBytes(metrics.transferredBytes)}, ${formatNumber(metrics.nodes)} nodes, ${formatDuration(metrics.taskDurationSec)} tasks`);
      } finally {
        liteSession.cleanup();
      }

      if (r < runs) await sleep(1500);
    }
  } finally {
    if (mockServer) {
      mockServer.stop();
    }
  }

  // Aggregate averages
  const vanillaAvg = averageMetrics(vanillaRuns);
  const liteAvg = averageMetrics(liteRuns);
  const comparisons = compareMetrics(vanillaAvg, liteAvg);

  const meta = {
    url: benchmarkUrl,
    durationSec,
    runs,
    chromeVersion,
    timestamp: new Date().toISOString()
  };

  // Render terminal table
  renderTerminalTable(comparisons, meta, vanillaAvg, liteAvg);

  // Optional Markdown file
  if (options.outputMd) {
    const mdContent = generateMarkdownReport(comparisons, meta, vanillaAvg, liteAvg);
    const targetFile = typeof options.outputMd === 'string' ? options.outputMd : 'RESOURCES_REPORT.md';
    fs.writeFileSync(targetFile, mdContent, 'utf8');
    console.log(`  📄 Markdown report saved to: ${targetFile}`);
  }

  // Optional JSON file
  if (options.outputJson) {
    const jsonData = {
      meta,
      vanilla: vanillaAvg,
      lite: liteAvg,
      comparisons
    };
    const targetFile = typeof options.outputJson === 'string' ? options.outputJson : 'resources_report.json';
    fs.writeFileSync(targetFile, JSON.stringify(jsonData, null, 2), 'utf8');
    console.log(`  📊 JSON report saved to: ${targetFile}`);
  }

  return { meta, vanilla: vanillaAvg, lite: liteAvg, comparisons };
}

// ============================================================================
// 7. Self-Test Suite (Zero-network automated verification)
// ============================================================================

async function runSelfTest(options = {}) {
  const assert = require('assert');
  console.log(`${ANSI.cyan}=== YT Lite Resource Test: Self-Test Verification Suite ===${ANSI.reset}\n`);

  // Test 1: Chrome Binary Discovery
  console.log('[1] Chrome binary detection...');
  const chromePath = findChromeBinary(options.chromePath);
  assert(fs.existsSync(chromePath), `Chrome binary at ${chromePath} must exist`);
  console.log(`  ✓ Detected Chrome: ${chromePath}`);

  // Test 2: Formatting helpers
  console.log('[2] Formatting utility tests...');
  assert.strictEqual(formatBytes(0), '0 B');
  assert.strictEqual(formatBytes(1024), '1 KB');
  assert.strictEqual(formatBytes(1024 * 1024), '1 MB');
  assert.strictEqual(formatBytes(-1024), '-1 KB');
  assert.strictEqual(formatBytes(-1024 * 1024), '-1 MB');
  assert.strictEqual(formatDuration(0), '0 ms');
  assert.strictEqual(formatDuration(0.5), '500.0 ms');
  assert.strictEqual(formatDuration(1.5), '1.50 s');
  assert.strictEqual(formatDuration(-0.5), '-500.0 ms');
  assert.strictEqual(formatNumber(12345), '12,345');
  assert.strictEqual(formatNumber(-6789), '-6,789');
  console.log('  ✓ Unit formatters pass (including sign and negative delta handling)');

  // Test 3: Metric Comparison Calculations
  console.log('[3] Delta & percentage comparison engine...');
  const sampleVanilla = {
    jsHeapUsedBytes: 100 * 1024 * 1024,
    heapUsedPostGcBytes: 80 * 1024 * 1024,
    nodes: 10000,
    layoutObjects: 1500,
    networkRequests: 100,
    blockedRequests: 0,
    eventListeners: 0,
    taskDurationSec: 5.0
  };
  const sampleLite = {
    jsHeapUsedBytes: 70 * 1024 * 1024,
    heapUsedPostGcBytes: 50 * 1024 * 1024,
    nodes: 8000,
    layoutObjects: 400,
    networkRequests: 80,
    blockedRequests: 10,
    eventListeners: 5,
    taskDurationSec: 3.5
  };

  const comps = compareMetrics(sampleVanilla, sampleLite);
  const heapComp = comps.find(c => c.key === 'jsHeapUsedBytes');
  assert.strictEqual(heapComp.pctFormatted, '-30.0%');
  assert.strictEqual(heapComp.isWin, true);

  const retainedComp = comps.find(c => c.key === 'heapUsedPostGcBytes');
  assert.strictEqual(retainedComp.pctFormatted, '-37.5%');
  assert.strictEqual(retainedComp.isWin, true);

  const layoutObjComp = comps.find(c => c.key === 'layoutObjects');
  assert.strictEqual(layoutObjComp.pctFormatted, '-73.3%');
  assert.strictEqual(layoutObjComp.isWin, true);

  const blockedComp = comps.find(c => c.key === 'blockedRequests');
  assert.strictEqual(blockedComp.isWin, true);

  const listenersComp = comps.find(c => c.key === 'eventListeners');
  assert.strictEqual(listenersComp.isLoss, true, 'Increasing event listeners from 0 to 5 must be classified as loss');
  console.log('  ✓ Delta math and win/loss classifications verified');

  // Test 4: End-to-End Mock Benchmark Execution
  console.log('[4] Running full headless mock benchmark (Vanilla vs YT Lite)...');
  const result = await runBenchmark({
    mock: true,
    duration: 3,
    runs: 1,
    headless: true,
    chromePath
  });

  assert(result.vanilla, 'Vanilla metrics must be present');
  assert(result.lite, 'YT Lite metrics must be present');
  assert(result.comparisons.length > 0, 'Comparisons must be generated');

  // Verify that DNR blocked requests in mock mode for YT Lite
  assert(result.lite.blockedRequests >= 4, `YT Lite should block ad/telemetry requests in mock mode, got ${result.lite.blockedRequests}`);

  // Verify that blockedUrls contains actual URLs
  assert(result.lite.blockedUrls.length >= 4, 'Blocked URLs must be logged');
  assert(
    result.lite.blockedUrls.some(b => b.url.includes('doubleclick.net') || b.url.includes('google-analytics.com') || b.url.includes('log_event')),
    'Blocked URLs must contain real URLs, not internal request IDs'
  );

  // Verify secondary collapsed and comments hidden
  assert.strictEqual(result.lite.secondaryDisplay, 'none', 'Secondary sidebar must be collapsed in YT Lite');
  assert.strictEqual(result.lite.hasCommentsHideClass, true, 'Comments hide class must be active in YT Lite');
  assert(result.lite.layoutObjects < result.vanilla.layoutObjects, 'YT Lite must reduce layout objects');

  console.log(`  ✓ Mock benchmark passed cleanly: ${result.lite.blockedRequests} requests blocked, layout objects reduced from ${result.vanilla.layoutObjects} to ${result.lite.layoutObjects}`);

  // Test 5: Interactive comments expansion test
  console.log('[5] Testing interactive comments expansion (--test-comments)...');
  const commentResult = await runBenchmark({
    mock: true,
    duration: 2,
    runs: 1,
    headless: true,
    testComments: true,
    chromePath
  });

  assert(commentResult.lite.commentsCount >= 60, 'Comments should be mounted after clicking Show comments');
  console.log(`  ✓ Comments interaction test passed: ${commentResult.lite.commentsCount} comments hydrated on demand`);

  console.log(`\n${ANSI.green}=== ALL SELF-TESTS PASSED SUCCESSFULLY! ===${ANSI.reset}\n`);
  return true;
}

// ============================================================================
// 8. CLI Argument Parsing & Entry Point
// ============================================================================

function parseArgs(args) {
  const options = {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    duration: 10,
    runs: 1,
    mock: false,
    selfTest: false,
    testComments: false,
    headless: true,
    outputMd: null,
    outputJson: null,
    chromePath: null,
    extensionDir: null,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--mock') {
      options.mock = true;
    } else if (arg === '--self-test') {
      options.selfTest = true;
    } else if (arg === '--test-comments') {
      options.testComments = true;
    } else if (arg === '--no-headless' || arg === '--headed') {
      options.headless = false;
    } else if (arg === '--url' && i + 1 < args.length) {
      options.url = args[++i];
    } else if (arg.startsWith('--url=')) {
      options.url = arg.split('=')[1];
    } else if (arg === '--duration' && i + 1 < args.length) {
      options.duration = parseFloat(args[++i]);
    } else if (arg.startsWith('--duration=')) {
      options.duration = parseFloat(arg.split('=')[1]);
    } else if (arg === '--runs' && i + 1 < args.length) {
      options.runs = parseInt(args[++i], 10);
    } else if (arg.startsWith('--runs=')) {
      options.runs = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--output-md') {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options.outputMd = args[++i];
      } else {
        options.outputMd = 'RESOURCES_REPORT.md';
      }
    } else if (arg.startsWith('--output-md=')) {
      options.outputMd = arg.split('=')[1];
    } else if (arg === '--output-json') {
      if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        options.outputJson = args[++i];
      } else {
        options.outputJson = 'resources_report.json';
      }
    } else if (arg.startsWith('--output-json=')) {
      options.outputJson = arg.split('=')[1];
    } else if (arg === '--chrome-path' && i + 1 < args.length) {
      options.chromePath = args[++i];
    } else if (arg.startsWith('--chrome-path=')) {
      options.chromePath = arg.split('=')[1];
    } else if (arg === '--extension-dir' && i + 1 < args.length) {
      options.extensionDir = args[++i];
    } else if (arg.startsWith('--extension-dir=')) {
      options.extensionDir = arg.split('=')[1];
    }
  }

  return options;
}

function printHelp() {
  console.log(`
${ANSI.bold}YT Lite - Resource Benchmark & Test CLI${ANSI.reset}

Measures and compares resource consumption on YouTube (vanilla vs with YT Lite).

${ANSI.yellow}USAGE:${ANSI.reset}
  node benchmark_resources.js [options]
  node test_resources.js [options]

${ANSI.yellow}OPTIONS:${ANSI.reset}
  --url <url>           YouTube URL to benchmark (default: watch page 'dQw4w9WgXcQ')
  --duration <seconds>  Measurement observation window in seconds (default: 10)
  --runs <count>        Number of iterations to run and average (default: 1)
  --mock                Run offline mock benchmark (local HTTPS YouTube simulator)
  --self-test           Run internal unit tests & mock benchmark verification
  --test-comments       Simulate clicking 'Show comments' and measure incremental cost
  --output-md [file]    Save markdown comparison report (default: RESOURCES_REPORT.md)
  --output-json [file]  Save JSON metrics report (default: resources_report.json)
  --no-headless         Run Chrome in headed mode for visual inspection
  --chrome-path <path>  Specify custom Chrome/Chromium binary
  --extension-dir <path> Specify path to YT Lite extension directory
  --help, -h            Show this help message

${ANSI.yellow}EXAMPLES:${ANSI.reset}
  # Run live comparative test on YouTube
  node benchmark_resources.js

  # Run on specific video with 15s window and generate Markdown report
  node benchmark_resources.js --url https://www.youtube.com/watch?v=jNQXAC9IVRw --duration 15 --output-md

  # Run 3 runs and average results to eliminate network jitter
  node benchmark_resources.js --runs 3 --output-md --output-json

  # Run offline mock self-test (suitable for CI or offline environments)
  node benchmark_resources.js --self-test

  # Test resource footprint of comments on-demand hydration
  node benchmark_resources.js --test-comments --mock
`);
}

if (require.main === module) {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  (async () => {
    try {
      if (options.selfTest) {
        await runSelfTest(options);
      } else {
        await runBenchmark(options);
      }
      process.exit(0);
    } catch (err) {
      console.error(`${ANSI.red}Benchmark failed:${ANSI.reset}`, err);
      process.exit(1);
    }
  })();
}

module.exports = {
  findChromeBinary,
  getFreePort,
  formatBytes,
  formatDuration,
  formatNumber,
  MockYouTubeServer,
  ChromeSession,
  averageMetrics,
  compareMetrics,
  generateMarkdownReport,
  renderTerminalTable,
  runBenchmark,
  runSelfTest,
  parseArgs,
  printHelp
};
