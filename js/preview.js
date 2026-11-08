/* Canvas preview + compressed playback of a toolpath. */

export class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.paths = [];
    this.profile = null;
    this.pen = null;
    this.machine = null;
    this.source = null;       // { image, x, y, w, h } in mm, drawn under the toolpath
    this.travel = [];
    this.flat = [];
    this.totalLen = 0;
    this.w = 0;
    this.h = 0;
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this._raf = null;
    this._sim = null;
    this._sourceCache = new WeakMap();
    this.onProgress = null; // (fraction 0..1) during simulated playback
    this.onDone = null;
    this._observe();
  }

  _observe() {
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.render());
      this._ro.observe(this.canvas.parentElement || this.canvas);
    } else {
      window.addEventListener('resize', () => this.render());
    }
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(120, Math.round(rect.width));
    const h = Math.max(120, Math.round(rect.height));
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    this.w = w;
    this.h = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  _fit() {
    const work = this.profile?.work || { x: 150, y: 150 };
    const pad = 26;
    const sx = (this.w - pad * 2) / Math.max(1, work.x);
    const sy = (this.h - pad * 2) / Math.max(1, work.y);
    this.scale = Math.min(sx, sy);
    this.ox = (this.w - work.x * this.scale) / 2;
    this.oy = (this.h - work.y * this.scale) / 2;
  }

  tx(x) { return this.ox + x * this.scale; }
  ty(y) { return this.oy + ((this.profile?.work?.y || 150) - y) * this.scale; }

  setData(paths, profile) {
    this.paths = paths || [];
    this.profile = profile;
    this._buildFlat();
    this.render();
  }

  /* Draw the uploaded raster/SVG source underneath the toolpath, exactly where
   * the generated G-code will plot it. LaserGRBL and UGS both preview the
   * source image this way; without it an image trace looks like random lines. */
  setSource(source) {
    if (!source || !source.image) {
      this.source = null;
      this.render();
      return;
    }
    const image = source.image;
    let cached = this._sourceCache.get(image);
    if (!cached) {
      const iw = image.naturalWidth || image.width || 1;
      const ih = image.naturalHeight || image.height || 1;
      const scale = Math.min(1, 900 / Math.max(iw, ih));
      cached = document.createElement('canvas');
      cached.width = Math.max(1, Math.round(iw * scale));
      cached.height = Math.max(1, Math.round(ih * scale));
      cached.getContext('2d').drawImage(image, 0, 0, cached.width, cached.height);
      this._sourceCache.set(image, cached);
    }
    this.source = { ...source, image: cached };
    this.render();
  }

  setMachine(pos) {
    this.machine = pos;
    if (!this._sim) this.render();
  }

  _buildFlat() {
    this.travel = [];
    this.flat = [];
    this.totalLen = 0;
    let cursor = { x: 0, y: 0 };
    for (const path of this.paths) {
      if (!path.points.length) continue;
      const first = path.points[0];
      this.travel.push({ x1: cursor.x, y1: cursor.y, x2: first.x, y2: first.y });
      for (let i = 1; i < path.points.length; i++) {
        const a = path.points[i - 1];
        const b = path.points[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-6) continue;
        this.totalLen += len;
        this.flat.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, len, cum: this.totalLen });
      }
      cursor = path.points[path.points.length - 1];
    }
  }

  _paper(ctx) {
    const work = this.profile?.work || { x: 150, y: 150 };
    const x0 = this.tx(0);
    const y0 = this.ty(work.y);
    const w = work.x * this.scale;
    const h = work.y * this.scale;

    ctx.fillStyle = '#f7f4ec';
    ctx.fillRect(x0, y0, w, h);

    // 10 mm grid
    ctx.strokeStyle = 'rgba(60, 60, 50, 0.10)';
    ctx.lineWidth = 1;
    const step = 10;
    for (let x = step; x < work.x; x += step) {
      ctx.beginPath();
      ctx.moveTo(this.tx(x), y0);
      ctx.lineTo(this.tx(x), y0 + h);
      ctx.stroke();
    }
    for (let y = step; y < work.y; y += step) {
      ctx.beginPath();
      ctx.moveTo(x0, this.ty(y));
      ctx.lineTo(x0 + w, this.ty(y));
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(30, 30, 25, 0.55)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);

    // origin marker
    ctx.fillStyle = 'rgba(20, 120, 80, 0.9)';
    ctx.beginPath();
    ctx.arc(this.tx(0), this.ty(0), 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(30,30,30,0.45)';
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(`${work.x} × ${work.y} mm`, x0 + 8, y0 + h - 8);
  }

  _drawSource(ctx) {
    const s = this.source;
    if (!s || !s.image) return;
    const work = this.profile?.work || { x: 150, y: 150 };
    const x = this.tx(s.x);
    const y = this.ty(s.y + s.h);
    const w = Math.max(1, s.w * this.scale);
    const h = Math.max(1, s.h * this.scale);

    ctx.save();
    // Keep the source inside the paper rectangle.
    ctx.beginPath();
    ctx.rect(this.tx(0), this.ty(work.y), work.x * this.scale, work.y * this.scale);
    ctx.clip();

    ctx.globalAlpha = 0.38;
    try {
      ctx.drawImage(s.image, x, y, w, h);
    } catch {
      /* image may not be decodable yet */
    }
    ctx.globalAlpha = 1;

    // Dashed bounds so the user can see where the image will be plotted.
    ctx.strokeStyle = 'rgba(90, 130, 200, 0.55)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  _drawPaths(ctx, { ghost = false, limit = Infinity } = {}) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ghost) {
      ctx.strokeStyle = 'rgba(30, 30, 30, 0.10)';
      ctx.lineWidth = 1;
    } else {
      ctx.strokeStyle = '#16181c';
      ctx.lineWidth = Math.max(1, Math.min(2.2, this.scale * 0.22));
    }
    let drawn = 0;
    for (const seg of this.flat) {
      if (drawn >= limit) break;
      ctx.beginPath();
      ctx.moveTo(this.tx(seg.x1), this.ty(seg.y1));
      ctx.lineTo(this.tx(seg.x2), this.ty(seg.y2));
      ctx.stroke();
      drawn += seg.len;
    }
    ctx.restore();
  }

  _drawTravel(ctx) {
    if (!this.travel.length) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(70, 120, 180, 0.28)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    for (const t of this.travel) {
      ctx.moveTo(this.tx(t.x1), this.ty(t.y1));
      ctx.lineTo(this.tx(t.x2), this.ty(t.y2));
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawMachine(ctx) {
    if (!this.machine) return;
    const x = this.tx(this.machine.x);
    const y = this.ty(this.machine.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(230, 120, 60, 0.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y);
    ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 6);
    ctx.stroke();
    ctx.restore();
  }

  render() {
    if (!this.canvas.isConnected) return;
    this._resize();
    if (!this.profile) {
      this.ctx.clearRect(0, 0, this.w, this.h);
      this.ctx.fillStyle = '#8a93a3';
      this.ctx.font = '14px ui-sans-serif, system-ui, sans-serif';
      this.ctx.fillText('Upload an image, open an SVG, or type text to begin.', 24, 34);
      return;
    }
    this._fit();
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    this._paper(ctx);
    this._drawSource(ctx);
    this._drawTravel(ctx);
    this._drawPaths(ctx);
    this._drawMachine(ctx);
    if (!this._sim) this._drawPen(ctx, this.pen);
  }

  startSimulation(seconds = 20) {
    if (!this.totalLen) return false;
    this.stopSimulation({ keepFrame: false });
    this._resize();
    this._fit();

    const dpr = window.devicePixelRatio || 1;
    const layer = document.createElement('canvas');
    layer.width = this.canvas.width;
    layer.height = this.canvas.height;
    const lctx = layer.getContext('2d');
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._paper(lctx);
    this._drawSource(lctx);
    this._drawPaths(lctx, { ghost: true });

    this._sim = {
      layer,
      lctx,
      start: performance.now(),
      duration: Math.max(3000, seconds * 1000),
      index: 0,
      drawn: 0,
      done: false
    };
    this._simFrame();
    return true;
  }

  _simFrame() {
    const sim = this._sim;
    if (!sim) return;
    const now = performance.now();
    const p = Math.min(1, (now - sim.start) / sim.duration);
    const target = this.totalLen * p;
    const lctx = sim.lctx;
    lctx.strokeStyle = '#16181c';
    lctx.lineWidth = Math.max(1, Math.min(2.2, this.scale * 0.22));
    lctx.lineCap = 'round';
    lctx.lineJoin = 'round';

    let pen = this.paths[0]?.points[0] || { x: 0, y: 0 };
    while (sim.index < this.flat.length) {
      const seg = this.flat[sim.index];
      if (seg.cum > target) {
        // Draw the partial segment.
        const prev = sim.index === 0 ? 0 : this.flat[sim.index - 1].cum;
        const t = (target - prev) / seg.len;
        if (t > 0) {
          lctx.beginPath();
          lctx.moveTo(this.tx(seg.x1), this.ty(seg.y1));
          lctx.lineTo(this.tx(seg.x1 + (seg.x2 - seg.x1) * t), this.ty(seg.y1 + (seg.y2 - seg.y1) * t));
          lctx.stroke();
        }
        pen = { x: seg.x1, y: seg.y1 };
        break;
      }
      lctx.beginPath();
      lctx.moveTo(this.tx(seg.x1), this.ty(seg.y1));
      lctx.lineTo(this.tx(seg.x2), this.ty(seg.y2));
      lctx.stroke();
      pen = { x: seg.x2, y: seg.y2 };
      sim.index++;
      sim.drawn = seg.cum;
      if (sim.index >= this.flat.length) { sim.done = true; break; }
    }

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.drawImage(sim.layer, 0, 0, this.w, this.h);
    this._drawMachine(ctx);
    this._drawPen(ctx, pen);
    this._simPen = pen;
    this.onProgress?.(p);

    if (p < 1) {
      this._raf = requestAnimationFrame(() => this._simFrame());
    } else {
      this._raf = null;
      this._drawPen(ctx, pen);
      this.onDone?.();
    }
  }

  _drawPen(ctx, pen) {
    const p = pen || this.pen;
    if (!p) return;
    const x = this.tx(p.x);
    const y = this.ty(p.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(72, 190, 140, 0.20)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = '#2f9e6b';
    ctx.fill();
    ctx.restore();
  }

  stopSimulation({ keepFrame = false } = {}) {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
    this._sim = null;
    if (!keepFrame) this.render();
  }

  isSimulating() {
    return Boolean(this._sim);
  }
}
