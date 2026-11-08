/* Web Serial transport for GRBL.
 * Simple, reliable line-by-line streaming: each line waits for GRBL's "ok".
 * The 28BYJ-48 machine is slow, so the extra round-trip is irrelevant and this
 * avoids the failure modes of character-counting streamers.
 */

const RX_TIMEOUT = 20000;

function parseStatus(line) {
  const body = line.replace(/^<|>$/g, '');
  const parts = body.split('|');
  const out = { state: parts[0] || 'Unknown', fields: {}, raw: line };
  for (const part of parts.slice(1)) {
    const i = part.indexOf(':');
    if (i > 0) out.fields[part.slice(0, i)] = part.slice(i + 1);
  }
  const vec = (key) => {
    const v = out.fields[key];
    if (!v) return null;
    const nums = v.split(',').map(Number);
    return nums.length === 3 && nums.every(Number.isFinite) ? nums : null;
  };
  out.mpos = vec('MPos');
  out.wpos = vec('WPos');
  out.wco = vec('WCO');
  // GRBL's status report usually contains MPos and WCO (work coordinate
  // offset). Work position is MPos - WCO. Prefer a real WPos field if the
  // controller was configured to report it.
  if (!out.wpos && out.mpos && out.wco) {
    out.wpos = out.mpos.map((v, i) => v - out.wco[i]);
  }
  if (out.fields.FS) out.fs = out.fields.FS.split(',').map(Number);
  return out;
}

export class GrblSerial extends EventTarget {
  constructor() {
    super();
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.decoder = new TextDecoder();
    this.buffer = '';
    this.connected = false;
    this.state = 'Disconnected';
    this.lastStatus = null;
    this._pending = null;        // { resolve, reject, timer }
    this._collector = null;      // { lines } while collecting a multi-line response
    this._statusTimer = null;
    this._closing = false;
    this._streaming = false;
    this._abort = false;
    this.readTimer = null;
  }

  static supported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  /* True while a command is waiting for GRBL's "ok". */
  get busy() {
    return Boolean(this._pending);
  }

  async _permittedPorts() {
    if (!GrblSerial.supported()) return [];
    try {
      return await navigator.serial.getPorts();
    } catch {
      return [];
    }
  }

  /* Try to open a previously-permitted port without a picker. */
  async autoConnect() {
    const ports = await this._permittedPorts();
    if (!ports.length) return false;
    let hint = null;
    try {
      hint = JSON.parse(localStorage.getItem('plotter.port.v1') || 'null');
    } catch { /* ignore */ }
    let port = ports[0];
    if (hint) {
      const match = ports.find((p) => {
        const i = p.getInfo();
        return i.usbVendorId === hint.usbVendorId && i.usbProductId === hint.usbProductId;
      });
      if (match) port = match;
    }
    try {
      await this.open(port);
      return true;
    } catch {
      return false;
    }
  }

  async requestAndConnect() {
    if (!GrblSerial.supported()) {
      throw new Error('Web Serial is not available. Use Chrome or Edge on http://localhost.');
    }
    const port = await navigator.serial.requestPort();
    await this.open(port);
    return port;
  }

  async open(port) {
    if (this.connected) await this.disconnect();
    await port.open({ baudRate: 115200, bufferSize: 4096 });
    this.port = port;
    this.connected = true;
    this.reader = port.readable.getReader();
    this.writer = port.writable.getWriter();
    this.decoder = new TextDecoder();
    this.buffer = '';
    this._closing = false;
    this._abort = false;
    try {
      localStorage.setItem('plotter.port.v1', JSON.stringify(port.getInfo ? port.getInfo() : {}));
    } catch { /* ignore */ }
    this._statusTimer = setInterval(() => {
      if (this.connected) this.writeRaw('?').catch(() => {});
    }, 300);
    this.readTimer = this._readLoop();
    this.dispatchEvent(new CustomEvent('connected', { detail: { port } }));
  }

  async _readLoop() {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        this.buffer += this.decoder.decode(value, { stream: true });
        let idx;
        while ((idx = this.buffer.indexOf('\n')) >= 0) {
          let line = this.buffer.slice(0, idx);
          this.buffer = this.buffer.slice(idx + 1);
          line = line.replace(/\r/g, '');
          if (line.length) this._handleLine(line);
        }
      }
    } catch (err) {
      if (!this._closing) this._emitError(err);
    } finally {
      if (!this._closing) this._teardown('Device disconnected');
    }
  }

  _handleLine(line) {
    if (line.startsWith('<')) {
      const st = parseStatus(line);
      this.lastStatus = st;
      this.state = st.state;
      this.dispatchEvent(new CustomEvent('status', { detail: st }));
      return;
    }
    if (line.startsWith('ok')) {
      if (this._collector) {
        const lines = this._collector.lines;
        this._collector = null;
        this._resolve({ ok: true, lines });
      } else {
        this._resolve({ ok: true, lines: [] });
      }
      return;
    }
    if (/^error[: ]/.test(line)) {
      this.dispatchEvent(new CustomEvent('grbl-error', { detail: line }));
      this._reject(new Error(line));
      return;
    }
    if (line.startsWith('ALARM')) {
      this.dispatchEvent(new CustomEvent('alarm', { detail: line }));
      this._reject(new Error(line));
      return;
    }
    if (line.startsWith('[MSG:')) {
      this.dispatchEvent(new CustomEvent('message', { detail: line }));
      return;
    }
    if (line.startsWith('Grbl ')) {
      this.dispatchEvent(new CustomEvent('firmware', { detail: line }));
      return;
    }
    if (this._collector) this._collector.lines.push(line);
    this.dispatchEvent(new CustomEvent('line', { detail: line }));
  }

  _resolve(value) {
    if (!this._pending) return;
    const p = this._pending;
    this._pending = null;
    clearTimeout(p.timer);
    p.resolve(value);
  }

  _reject(err) {
    if (!this._pending) return;
    const p = this._pending;
    this._pending = null;
    clearTimeout(p.timer);
    p.reject(err);
  }

  _emitError(err) {
    this.dispatchEvent(new CustomEvent('transport-error', { detail: err }));
  }

  async writeRaw(str) {
    if (!this.writer) throw new Error('Not connected');
    await this.writer.write(new TextEncoder().encode(str));
  }

  /* Send one line and resolve when GRBL replies ok. */
  sendLine(line, timeout = RX_TIMEOUT) {
    if (!this.connected) return Promise.reject(new Error('Not connected'));
    if (this._pending) return Promise.reject(new Error('Another command is still waiting for ok'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending = null;
        reject(new Error(`Timeout waiting for ok: ${line}`));
      }, timeout);
      this._pending = { resolve, reject, timer };
      this.dispatchEvent(new CustomEvent('tx', { detail: line }));
      this.writeRaw(line + '\n').catch((err) => {
        clearTimeout(timer);
        this._pending = null;
        reject(err);
      });
    });
  }

  /* Send a command that returns several lines before ok (e.g. $$). */
  async collect(line, timeout = 8000) {
    if (!this.connected) throw new Error('Not connected');
    if (this._pending) throw new Error('Another command is still waiting for ok');
    this._collector = { lines: [] };
    try {
      const res = await this.sendLine(line, timeout);
      return res.lines;
    } finally {
      this._collector = null;
    }
  }

  async stream(lines, { onProgress, shouldStop } = {}) {
    if (!this.connected) throw new Error('Not connected');
    this._streaming = true;
    this._abort = false;
    const total = lines.length;
    try {
      for (let i = 0; i < total; i++) {
        if (this._abort) throw new Error('Stopped');
        if (shouldStop && shouldStop()) throw new Error('Stopped');
        const line = lines[i];
        if (!line || line.startsWith(';') || line.startsWith('(')) continue;
        try {
          await this.sendLine(line, 30000);
        } catch (err) {
          const short = line.length > 60 ? `${line.slice(0, 60)}…` : line;
          throw new Error(`${err.message} (line ${i + 1}: ${short})`);
        }
        // Ask for a position report every few lines. The normal 300 ms timer
        // is throttled when Chrome is in the background; this keeps the live
        // marker moving while a job is streaming.
        if (i % 3 === 0) this.writeRaw('?').catch(() => {});
        if (onProgress && (i % 10 === 0 || i === total - 1)) onProgress(i + 1, total);
      }
    } finally {
      this._streaming = false;
      this._abort = false;
    }
  }

  stopStream() {
    this._abort = true;
  }

  /* Abort a command that is waiting for "ok" (used after a soft reset). */
  abortPending(reason = 'Aborted') {
    this._reject(new Error(reason));
  }

  pause() {
    return this.writeRaw('!');
  }

  resume() {
    return this.writeRaw('~');
  }

  reset() {
    return this.writeRaw(String.fromCharCode(0x18));
  }

  jogCancel() {
    return this.writeRaw(String.fromCharCode(0x85));
  }

  async disconnect() {
    if (!this.port) return;
    this._closing = true;
    clearInterval(this._statusTimer);
    this._statusTimer = null;
    this._reject(new Error('Disconnected'));
    try { await this.reader?.cancel(); } catch { /* ignore */ }
    try { this.reader?.releaseLock(); } catch { /* ignore */ }
    try { await this.writer?.close(); } catch { /* ignore */ }
    try { this.writer?.releaseLock?.(); } catch { /* ignore */ }
    try { await this.port.close(); } catch { /* ignore */ }
    this.connected = false;
    this.reader = null;
    this.writer = null;
    this.port = null;
    this.dispatchEvent(new Event('disconnected'));
  }

  _teardown(reason) {
    if (!this.connected) return;
    this._closing = true;
    clearInterval(this._statusTimer);
    this._statusTimer = null;
    this.connected = false;
    this.reader = null;
    this.writer = null;
    this.port = null;
    this._reject(new Error(reason));
    this.dispatchEvent(new CustomEvent('disconnected', { detail: reason }));
  }
}
