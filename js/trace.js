/* Marching-squares contour extraction for binary masks.
 * Mask layout: Uint8Array of width*height, 1 = ink.
 * Returns polylines in grid units (0..width, 0..height). */

function rdp(points, eps) {
  const n = points.length;
  if (n < 3 || eps <= 0) return points;
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j - i < 2) continue;
    const ax = points[i].x, ay = points[i].y;
    const bx = points[j].x, by = points[j].y;
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = -1, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const px = points[k].x, py = points[k].y;
      const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > maxD) { maxD = d; idx = k; }
    }
    if (maxD > eps) {
      keep[idx] = 1;
      stack.push([i, idx], [idx, j]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function key(p) {
  return `${p.x.toFixed(4)},${p.y.toFixed(4)}`;
}

/* Public helper: reduce a polyline's node count with Ramer–Douglas–Peucker.
 * Used by the SVG importer so curve tolerance has an effect.
 *
 * RDP collapses a closed ring when the first and last point are identical:
 * the reference segment has zero length, so every point measures as zero
 * distance. Split the ring in half and simplify each half separately. */
export function simplifyPolyline(points, eps) {
  if (!points || points.length < 3 || eps <= 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const closed = points.length > 3 &&
    Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6;
  if (!closed) return rdp(points, eps);

  const ring = points.slice(0, -1);
  if (ring.length < 3) return points;
  const mid = Math.floor(ring.length / 2);
  const a = rdp(ring.slice(0, mid + 1), eps);
  const b = rdp(ring.slice(mid).concat([ring[0]]), eps);
  return a.concat(b.slice(1));
}

/* Build segments for every 2x2 cell, then chain them into polylines. */
export function traceMask(mask, width, height, { simplify = 0.35, minLength = 1.2 } = {}) {
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x]);
  const segments = [];

  const top = (x, y) => ({ x: x + 0.5, y });
  const right = (x, y) => ({ x: x + 1, y: y + 0.5 });
  const bottom = (x, y) => ({ x: x + 0.5, y: y + 1 });
  const left = (x, y) => ({ x, y: y + 0.5 });

  const add = (a, b) => segments.push({ a, b, used: false });

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      const c = tl * 8 + tr * 4 + br * 2 + bl;
      if (c === 0 || c === 15) continue;

      switch (c) {
        case 1: add(left(x, y), bottom(x, y)); break;
        case 2: add(bottom(x, y), right(x, y)); break;
        case 3: add(left(x, y), right(x, y)); break;
        case 4: add(top(x, y), right(x, y)); break;
        case 5: {
          const center = at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1) >= 2;
          if (center) { add(left(x, y), top(x, y)); add(right(x, y), bottom(x, y)); }
          else { add(top(x, y), right(x, y)); add(bottom(x, y), left(x, y)); }
          break;
        }
        case 6: add(top(x, y), bottom(x, y)); break;
        case 7: add(left(x, y), top(x, y)); break;
        case 8: add(top(x, y), left(x, y)); break;
        case 9: add(top(x, y), bottom(x, y)); break;
        case 10: {
          const center = at(x, y) + at(x + 1, y) + at(x + 1, y + 1) + at(x, y + 1) >= 2;
          if (center) { add(top(x, y), right(x, y)); add(bottom(x, y), left(x, y)); }
          else { add(left(x, y), top(x, y)); add(right(x, y), bottom(x, y)); }
          break;
        }
        case 11: add(top(x, y), right(x, y)); break;
        case 12: add(left(x, y), right(x, y)); break;
        case 13: add(bottom(x, y), right(x, y)); break;
        case 14: add(bottom(x, y), left(x, y)); break;
        default: break;
      }
    }
  }

  // Index segment endpoints.
  const buckets = new Map();
  const push = (p, i) => {
    const k = key(p);
    let arr = buckets.get(k);
    if (!arr) { arr = []; buckets.set(k, arr); }
    arr.push(i);
  };
  segments.forEach((s, i) => { push(s.a, i); push(s.b, i); });

  const takeNext = (point) => {
    const arr = buckets.get(key(point));
    if (!arr) return null;
    for (const i of arr) {
      if (!segments[i].used) { segments[i].used = true; return segments[i]; }
    }
    return null;
  };

  const lines = [];

  for (let i = 0; i < segments.length; i++) {
    if (segments[i].used) continue;
    const seg = segments[i];
    seg.used = true;
    const poly = [seg.a, seg.b];
    let end = seg.b;

    for (let guard = 0; guard < segments.length + 4; guard++) {
      const next = takeNext(end);
      if (!next) break;
      const p = key(next.a) === key(end) ? next.b : next.a;
      // Avoid zero-length loops.
      if (p.x === end.x && p.y === end.y) break;
      poly.push(p);
      end = p;
    }

    if (poly.length < 2) continue;

    let pts = poly;
    let closed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-3;
    if (closed && pts.length > 3) pts = pts.slice(0, -1);
    if (simplify > 0) {
      if (closed) {
        // RDP on a closed ring: split in half to avoid collapsing it.
        const ring = simplifyPolyline([...pts, pts[0]], simplify);
        pts = ring.length > 2 ? ring.slice(0, -1) : pts;
      } else {
        pts = rdp(pts, simplify);
      }
    }
    if (pts.length < 2) continue;

    let len = 0;
    for (let k = 1; k < pts.length; k++) len += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
    if (closed) len += Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y);
    if (len < minLength) continue;

    if (closed) pts.push(pts[0]);
    lines.push({ points: pts, closed });
  }

  return lines;
}
