// Tiny zero-dependency Chrome DevTools Protocol client over the global WebSocket
// provided by Bun. Used by the benchmark to drive real headless Chrome.
export class CDP {
  constructor(ws) {
    this.ws = ws;
    this._id = 0;
    this._pending = new Map();
    this._handlers = new Map();
    ws.onmessage = (ev) => this._onMessage(JSON.parse(ev.data));
    ws.onclose = () => {
      for (const { reject } of this._pending.values()) reject(new Error('CDP socket closed'));
      this._pending.clear();
    };
  }
  _onMessage(msg) {
    if (msg.id && this._pending.has(msg.id)) {
      const { resolve, reject } = this._pending.get(msg.id);
      this._pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else if (msg.method) {
      for (const fn of this._handlers.get(msg.method) || []) fn(msg.params);
    }
  }
  on(method, fn) {
    if (!this._handlers.has(method)) this._handlers.set(method, []);
    this._handlers.get(method).push(fn);
  }
  send(method, params = {}, sessionId) {
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      this._pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

export async function connect(port, { retries = 80, delayMs = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { webSocketDebuggerUrl } = await res.json();
      const ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws open failed')); });
      return new CDP(ws);
    } catch (err) { lastErr = err; await Bun.sleep(delayMs); }
  }
  throw new Error(`could not connect to Chrome on port ${port}: ${lastErr}`);
}
