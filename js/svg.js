/* Minimal SVG geometry importer.
 * Supports path/line/polyline/polygon/rect/circle/ellipse with nested
 * transforms (matrix, translate, scale, rotate, skew). Fill/stroke styling is
 * ignored: every outline is plotted. Geometry is scaled to the requested
 * width, so the SVG's own viewBox does not need to be honoured explicitly.
 * Good enough for logos, icons and Inkscape exports used with a pen plotter.
 */

const IDENT = [1, 0, 0, 1, 0, 0];

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5]
  ];
}

function apply(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

function parseTransform(text) {
  let m = IDENT.slice();
  if (!text) return m;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(text))) {
    const name = match[1].toLowerCase();
    const args = match[2].trim().split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    let t = IDENT.slice();
    if (name === 'matrix' && args.length >= 6) t = args.slice(0, 6);
    else if (name === 'translate') t = [1, 0, 0, 1, args[0] || 0, args[1] || 0];
    else if (name === 'scale') t = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
    else if (name === 'rotate') {
      const a = ((args[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(a), sin = Math.sin(a);
      const r = [cos, sin, -sin, cos, 0, 0];
      if (args.length >= 3) {
        const cx = args[1], cy = args[2];
        t = multiply(multiply([1, 0, 0, 1, cx, cy], r), [1, 0, 0, 1, -cx, -cy]);
      } else t = r;
    } else if (name === 'skewx') {
      t = [1, 0, Math.tan(((args[0] || 0) * Math.PI) / 180), 1, 0, 0];
    } else if (name === 'skewy') {
      t = [1, Math.tan(((args[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    }
    m = multiply(m, t);
  }
  return m;
}

const NUM = '[-+]?(?:\\d*\\.\\d+|\\d+\\.?)(?:[eE][-+]?\\d+)?';
const TOKEN_RE = new RegExp(`([MmZzLlHhVvCcSsQqTtAa])|(${NUM})`, 'g');

function tokenize(d) {
  const out = [];
  let m;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(d))) {
    out.push({ cmd: m[1] || null, num: m[1] ? null : parseFloat(m[2]) });
  }
  return out;
}

function cubicPoints(p0, p1, p2, p3, steps = 18) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
    });
  }
  return pts;
}

function quadPoints(p0, p1, p2, steps = 14) {
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    pts.push({
      x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
      y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y
    });
  }
  return pts;
}

function arcPoints(x1, y1, rx, ry, angleDeg, largeArc, sweep, x2, y2) {
  if (rx === 0 || ry === 0) return [{ x: x2, y: y2 }];
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const sign = largeArc === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= Math.PI * 2;
  if (sweep && dTheta < 0) dTheta += Math.PI * 2;
  const steps = Math.max(6, Math.min(120, Math.ceil(Math.abs(dTheta) / 0.12)));
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (dTheta * i) / steps;
    const x = cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin;
    const y = cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos;
    pts.push({ x, y });
  }
  return pts;
}

function parsePath(d) {
  const tokens = tokenize(d);
  const subpaths = [];
  let current = null;
  let cx = 0, cy = 0, startX = 0, startY = 0;
  let lastCubic = null, lastQuad = null;
  let cmd = null;
  let i = 0;

  const isNum = () => i < tokens.length && tokens[i].cmd === null;
  const num = () => tokens[i++].num;
  const begin = () => { current = { points: [], closed: false }; subpaths.push(current); };
  const add = (p) => {
    if (!current) begin();
    const last = current.points[current.points.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-9) current.points.push(p);
  };

  while (i < tokens.length) {
    if (tokens[i].cmd) { cmd = tokens[i].cmd; i++; }
    if (!cmd) break;

    if (cmd === 'Z' || cmd === 'z') {
      if (current) {
        current.closed = true;
        add({ x: startX, y: startY });
      }
      cx = startX; cy = startY;
      lastCubic = lastQuad = null;
      cmd = null;
      continue;
    }

    const rel = cmd === cmd.toLowerCase();
    const baseX = rel ? cx : 0;
    const baseY = rel ? cy : 0;
    const upper = cmd.toUpperCase();

    if (!isNum()) { cmd = null; continue; }

    switch (upper) {
      case 'M': {
        const x = num() + baseX, y = num() + baseY;
        cx = x; cy = y; startX = x; startY = y;
        begin();
        add({ x, y });
        lastCubic = lastQuad = null;
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        const x = num() + baseX, y = num() + baseY;
        add({ x, y }); cx = x; cy = y;
        lastCubic = lastQuad = null;
        break;
      }
      case 'H': {
        const x = num() + baseX;
        add({ x, y: cy }); cx = x;
        lastCubic = lastQuad = null;
        break;
      }
      case 'V': {
        const y = num() + baseY;
        add({ x: cx, y }); cy = y;
        lastCubic = lastQuad = null;
        break;
      }
      case 'C': {
        const x1 = num() + baseX, y1 = num() + baseY;
        const x2 = num() + baseX, y2 = num() + baseY;
        const x = num() + baseX, y = num() + baseY;
        cubicPoints({ x: cx, y: cy }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x, y }).forEach(add);
        lastCubic = { x: x2, y: y2 };
        lastQuad = null;
        cx = x; cy = y;
        break;
      }
      case 'S': {
        const x2 = num() + baseX, y2 = num() + baseY;
        const x = num() + baseX, y = num() + baseY;
        const x1 = lastCubic ? 2 * cx - lastCubic.x : cx;
        const y1 = lastCubic ? 2 * cy - lastCubic.y : cy;
        cubicPoints({ x: cx, y: cy }, { x: x1, y: y1 }, { x: x2, y: y2 }, { x, y }).forEach(add);
        lastCubic = { x: x2, y: y2 };
        lastQuad = null;
        cx = x; cy = y;
        break;
      }
      case 'Q': {
        const x1 = num() + baseX, y1 = num() + baseY;
        const x = num() + baseX, y = num() + baseY;
        quadPoints({ x: cx, y: cy }, { x: x1, y: y1 }, { x, y }).forEach(add);
        lastQuad = { x: x1, y: y1 };
        lastCubic = null;
        cx = x; cy = y;
        break;
      }
      case 'T': {
        const x = num() + baseX, y = num() + baseY;
        const x1 = lastQuad ? 2 * cx - lastQuad.x : cx;
        const y1 = lastQuad ? 2 * cy - lastQuad.y : cy;
        quadPoints({ x: cx, y: cy }, { x: x1, y: y1 }, { x, y }).forEach(add);
        lastQuad = { x: x1, y: y1 };
        lastCubic = null;
        cx = x; cy = y;
        break;
      }
      case 'A': {
        const rx = num(), ry = num(), rot = num();
        const large = num() ? 1 : 0;
        const sweep = num() ? 1 : 0;
        const x = num() + baseX, y = num() + baseY;
        arcPoints(cx, cy, rx, ry, rot, large, sweep, x, y).forEach(add);
        cx = x; cy = y;
        lastCubic = lastQuad = null;
        break;
      }
      default:
        cmd = null;
        break;
    }
  }

  return subpaths.filter((sp) => sp.points.length > 0);
}

function parsePointsAttr(text) {
  const nums = (text.match(new RegExp(NUM, 'g')) || []).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

function shapesFromElement(el, tag) {
  const f = (name, def = 0) => {
    const v = parseFloat(el.getAttribute(name));
    return Number.isFinite(v) ? v : def;
  };
  const out = [];
  if (tag === 'path') {
    const d = el.getAttribute('d');
    if (d) out.push(...parsePath(d));
  } else if (tag === 'line') {
    out.push({ points: [{ x: f('x1'), y: f('y1') }, { x: f('x2'), y: f('y2') }], closed: false });
  } else if (tag === 'polyline' || tag === 'polygon') {
    const pts = parsePointsAttr(el.getAttribute('points') || '');
    if (pts.length > 1) out.push({ points: pts, closed: tag === 'polygon' });
  } else if (tag === 'rect') {
    const x = f('x'), y = f('y'), w = f('width'), h = f('height');
    if (w > 0 && h > 0) {
      out.push({
        points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }],
        closed: true
      });
    }
  } else if (tag === 'circle' || tag === 'ellipse') {
    const cx = f('cx'), cy = f('cy');
    const rx = tag === 'circle' ? f('r') : f('rx');
    const ry = tag === 'circle' ? f('r') : f('ry');
    if (rx > 0 && ry > 0) {
      const pts = [];
      const steps = 64;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        pts.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
      }
      out.push({ points: pts, closed: true });
    }
  }
  return out;
}

function hidden(el) {
  const style = (el.getAttribute('style') || '').replace(/\s/g, '').toLowerCase();
  if (style.includes('display:none') || style.includes('visibility:hidden')) return true;
  if (el.getAttribute('display') === 'none' || el.getAttribute('visibility') === 'hidden') return true;
  if (el.getAttribute('fill') === 'none' && el.getAttribute('stroke') === 'none') return true;
  return false;
}

function walk(node, matrix, out) {
  if (!node || node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  if (['defs', 'clippath', 'mask', 'marker', 'pattern', 'style', 'title', 'desc', 'metadata', 'script'].includes(tag)) return;
  if (hidden(node)) return;

  let m = matrix;
  const tr = node.getAttribute('transform');
  if (tr) m = multiply(m, parseTransform(tr));

  if (['svg', 'g', 'a', 'switch'].includes(tag)) {
    for (const child of Array.from(node.children)) walk(child, m, out);
    return;
  }

  const shapes = shapesFromElement(node, tag);
  for (const sp of shapes) {
    const pts = sp.points.map((p) => apply(m, p));
    out.push({ points: pts, closed: sp.closed });
  }
}

export function parseSvg(text, { targetWidth = 100 } = {}) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('Could not parse SVG file.');
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') throw new Error('Not an SVG document.');

  const raw = [];
  walk(root, IDENT, raw);

  // Normalise: drop degenerate paths.
  const paths = raw.map((p) => {
    const pts = [];
    for (const pt of p.points) {
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(pt.x - last.x, pt.y - last.y) > 1e-7) pts.push(pt);
    }
    return { points: pts, closed: p.closed };
  }).filter((p) => p.points.length > 1);

  if (!paths.length) throw new Error('No drawable paths found in this SVG.');

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) {
    for (const pt of p.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) throw new Error('SVG has zero size.');

  const scale = targetWidth > 0 ? targetWidth / w : 1;
  const mmPaths = paths.map((p) => {
    const pts = p.points.map((pt) => ({ x: (pt.x - minX) * scale, y: (maxY - pt.y) * scale }));
    // Remove duplicated closing point, mark closed.
    let closed = p.closed;
    if (pts.length > 2) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) { pts.pop(); closed = true; }
    }
    if (closed && pts.length > 1) pts.push(pts[0]);
    return { points: pts, closed };
  });

  return { paths: mmPaths, width: w * scale, height: h * scale };
}
