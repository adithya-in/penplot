/* Toolpath → G-code + statistics. */

import { dist } from './pathopt.js';

const f3 = (n) => (Math.abs(n) < 5e-4 ? '0' : Number(n).toFixed(3).replace(/0+$/, '').replace(/\.$/, ''));

function dedupe(points, min = 0.02) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= min) out.push(p);
  }
  return out;
}

export function cleanPaths(paths) {
  return paths
    .map((p) => ({ ...p, points: dedupe(p.points) }))
    .filter((p) => p.points.length > 1);
}

export function boundsOf(paths) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) {
    for (const pt of p.points) {
      if (pt.x < minX) minX = pt.x;
      if (pt.y < minY) minY = pt.y;
      if (pt.x > maxX) maxX = pt.x;
      if (pt.y > maxY) maxY = pt.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

export function pathStats(paths, profile) {
  let drawDist = 0;
  let travelDist = 0;
  let cursor = { x: 0, y: 0 };
  for (const path of paths) {
    const first = path.points[0];
    travelDist += dist(cursor, first);
    for (let i = 1; i < path.points.length; i++) drawDist += dist(path.points[i - 1], path.points[i]);
    cursor = path.points[path.points.length - 1];
  }

  const lifts = paths.length;
  const zDist = Math.abs(profile.pen.up - profile.pen.down);
  const penFeed = Math.max(1, profile.pen.feed);
  const zTime = (2 * lifts * zDist) / penFeed * 60; // seconds
  const dwellTime = lifts * 2 * Math.max(0, profile.pen.dwell);
  const drawTime = (drawDist / Math.max(1, profile.feed.draw)) * 60;
  const travelTime = (travelDist / Math.max(1, profile.feed.travel)) * 60;

  return {
    drawDist,
    travelDist,
    lifts,
    time: drawTime + travelTime + zTime + dwellTime,
    drawTime,
    travelTime,
    zTime
  };
}

export function buildGcode(paths, profile, { returnHome = false, feedOverride = null } = {}) {
  const lines = [];
  const statsProfile = feedOverride
    ? { ...profile, feed: { ...profile.feed, draw: feedOverride } }
    : profile;
  const stats = pathStats(paths, statsProfile);
  const zOff = Number(profile.pen.zOffset) || 0;
  const up = f3(profile.pen.up + zOff);
  const down = f3(profile.pen.down + zOff);
  const penFeed = Math.max(1, Math.round(profile.pen.feed));
  const drawFeed = Math.max(1, Math.round(feedOverride ?? profile.feed.draw));
  const dwell = Math.max(0, profile.pen.dwell);

  lines.push('G21 ; millimetres', 'G90 ; absolute', 'G94 ; mm per minute');
  lines.push(`G0 Z${up} ; pen up`, `G4 P${Math.min(dwell, 1).toFixed(2)}`);

  for (const path of paths) {
    const first = path.points[0];
    lines.push(`G0 X${f3(first.x)} Y${f3(first.y)}`);
    lines.push(`G1 Z${down} F${penFeed}`);
    if (dwell > 0) lines.push(`G4 P${dwell.toFixed(2)}`);
    let feedSet = false;
    for (let i = 1; i < path.points.length; i++) {
      const pt = path.points[i];
      if (!feedSet) {
        lines.push(`G1 X${f3(pt.x)} Y${f3(pt.y)} F${drawFeed}`);
        feedSet = true;
      } else {
        lines.push(`G1 X${f3(pt.x)} Y${f3(pt.y)}`);
      }
    }
    lines.push(`G1 Z${up} F${penFeed}`);
    if (dwell > 0) lines.push(`G4 P${dwell.toFixed(2)}`);
  }

  if (returnHome) lines.push('G0 X0 Y0');
  lines.push('G0 Z' + up, 'M5');

  const bounds = boundsOf(paths);
  return { lines, text: lines.join('\n') + '\n', stats, bounds };
}

export function checkBounds(paths, profile) {
  const b = boundsOf(paths);
  const eps = 1e-3;
  const issues = [];
  if (b.minX < -eps) issues.push(`X below 0 (${b.minX.toFixed(2)} mm)`);
  if (b.minY < -eps) issues.push(`Y below 0 (${b.minY.toFixed(2)} mm)`);
  if (b.maxX > profile.work.x + eps) issues.push(`X beyond ${profile.work.x} mm (${b.maxX.toFixed(2)})`);
  if (b.maxY > profile.work.y + eps) issues.push(`Y beyond ${profile.work.y} mm (${b.maxY.toFixed(2)})`);
  return { bounds: b, issues };
}
