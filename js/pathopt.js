/* Toolpath ordering: nearest-neighbour, with closed-loop rotation and
 * open-path reversal. Keeps pen-up travel (and therefore drawing time) down. */

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function reverse(path) {
  return { ...path, points: path.points.slice().reverse() };
}

function rotateClosed(points, index) {
  // Rotate a closed loop so it starts at `index`, keeping the loop intact.
  const n = points.length;
  if (index <= 0 || index >= n) return points;
  return points.slice(index).concat(points.slice(0, index), [points[index]]);
}

export function optimizePaths(paths, start = { x: 0, y: 0 }, maxPaths = 3000) {
  const clean = paths.filter((p) => p.points && p.points.length > 1);
  if (clean.length <= 1 || clean.length > maxPaths) return clean;

  const pool = clean.map((p, idx) => ({ path: p, idx, used: false }));
  const out = [];
  let cursor = { ...start };

  for (let n = 0; n < pool.length; n++) {
    let best = null;
    let bestD = Infinity;
    let bestAt = 0;
    let bestRev = false;

    for (let i = 0; i < pool.length; i++) {
      const entry = pool[i];
      if (entry.used) continue;
      const pts = entry.path.points;
      const first = pts[0];
      const last = pts[pts.length - 1];

      if (entry.path.closed) {
        // For closed loops every vertex is a possible start.
        for (let k = 0; k < pts.length; k++) {
          const d = dist(cursor, pts[k]);
          if (d < bestD) { bestD = d; best = entry; bestAt = k; bestRev = false; }
        }
      } else {
        const d0 = dist(cursor, first);
        if (d0 < bestD) { bestD = d0; best = entry; bestAt = 0; bestRev = false; }
        const d1 = dist(cursor, last);
        if (d1 < bestD) { bestD = d1; best = entry; bestAt = 0; bestRev = true; }
      }
    }

    if (!best) break;
    best.used = true;
    let pts = bestRev ? reverse(best.path).points : best.path.points;
    if (best.path.closed && bestAt > 0) pts = rotateClosed(pts, bestAt);
    const ordered = { ...best.path, points: pts };
    out.push(ordered);
    cursor = pts[pts.length - 1];
  }

  return out;
}

/* Cheap 2-opt on the order only (endpoint to endpoint). Improves vector plots
 * noticeably without touching the geometry. */
export function twoOpt(paths, start = { x: 0, y: 0 }, rounds = 2) {
  if (paths.length < 4 || paths.length > 800) return paths;

  const startOf = (p) => p.points[0];
  const endOf = (p) => p.points[p.points.length - 1];
  const cost = (from, to) => dist(from, to);

  const order = paths.slice();
  const anchor = { ...start };

  for (let r = 0; r < rounds; r++) {
    let improved = false;
    for (let i = 0; i < order.length - 1; i++) {
      for (let j = i + 2; j < order.length - 1; j++) {
        const a = i === 0 ? anchor : endOf(order[i - 1]);
        const b = endOf(order[i]);
        const c = startOf(order[j]);
        const d = endOf(order[j]);
        const current = cost(a, b) + cost(c, d);
        const swapped = cost(a, c) + cost(b, d);
        if (swapped + 1e-6 < current) {
          order.splice(i + 1, j - i, ...order.slice(i + 1, j + 1).reverse());
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return order;
}

export function pathLength(path) {
  let total = 0;
  for (let i = 1; i < path.points.length; i++) total += dist(path.points[i - 1], path.points[i]);
  return total;
}

export { dist };
