/* Single-stroke text using the bundled Hershey font.
 * Output is in mm with the top-left of the text block at (0, 0); text extends
 * right and downward (negative Y), like a page.
 */

import { HERSHEY } from './hershey.js';

const cache = new Map();

function parseGlyph(d) {
  if (cache.has(d)) return cache.get(d);
  const subpaths = [];
  let current = null;
  let mode = 'L';
  for (const token of d.trim().split(/\s+/)) {
    let body = token;
    if (token[0] === 'M' || token[0] === 'L') {
      mode = token[0];
      body = token.slice(1);
    }
    const comma = body.indexOf(',');
    if (comma < 0) continue;
    const x = Number(body.slice(0, comma));
    const y = Number(body.slice(comma + 1));
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (mode === 'M') {
      current = [];
      subpaths.push(current);
      mode = 'L'; // subsequent ordinates are implicit lineto
    }
    if (!current) { current = []; subpaths.push(current); }
    current.push({ x, y });
  }
  const filtered = subpaths.filter((sp) => sp.length > 1);
  cache.set(d, filtered);
  return filtered;
}

/* advance in glyph units; 1.6 matches the HersheyText renderer spacing. */
const ADVANCE = 1.6;

export function textToPaths(text, {
  size = 10,
  letterSpace = 1,
  lineSpace = 1.7,
  align = 'left',
  angle = 0
} = {}) {
  const safeSize = Math.max(1, size);
  const s = safeSize / HERSHEY.capHeight;
  const lines = String(text ?? '').replace(/\r/g, '').split('\n');
  const lineHeight = safeSize * lineSpace;

  const laidOut = lines.map((line) => {
    const glyphs = [];
    let x = 0;
    for (const ch of line) {
      if (ch === ' ') {
        x += HERSHEY.spaceWidth * ADVANCE * s + letterSpace;
        continue;
      }
      const glyph = HERSHEY.glyphs[ch] || HERSHEY.glyphs['?'];
      if (!glyph) continue;
      glyphs.push({ glyph, x });
      x += glyph[0] * ADVANCE * s + letterSpace;
    }
    return { glyphs, width: Math.max(0, x - letterSpace) };
  });

  const maxWidth = Math.max(0, ...laidOut.map((l) => l.width));
  const paths = [];

  laidOut.forEach((line, li) => {
    const shift = align === 'center' ? (maxWidth - line.width) / 2
      : align === 'right' ? maxWidth - line.width : 0;
    for (const { glyph, x } of line.glyphs) {
      const subpaths = parseGlyph(glyph[1]);
      for (const sub of subpaths) {
        const pts = sub.map((p) => ({
          x: shift + x + p.x * s,
          y: -((p.y - 1) * s) - li * lineHeight
        }));
        if (pts.length > 1) paths.push({ points: pts, closed: false });
      }
    }
  });

  let width = maxWidth;
  let height = (lines.length - 1) * lineHeight + safeSize;

  if (angle) {
    const a = (angle * Math.PI) / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    for (const path of paths) {
      path.points = path.points.map((p) => ({
        x: p.x * cos - p.y * sin,
        y: p.x * sin + p.y * cos
      }));
    }
    // Approximate rotated bounds.
    width = maxWidth * Math.abs(cos) + height * Math.abs(sin);
    height = maxWidth * Math.abs(sin) + height * Math.abs(cos);
  }

  return { paths, width, height };
}
