/* Image → bitmap mask → plot paths.
 * Two families:
 *   - trace: marching-squares outlines (line art, logos)
 *   - raster: scanline / column / dot fills (photos, shading)
 */

import { traceMask } from './trace.js';

export function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

export function imageToGray(img, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { gray, width, height };
}

/* Stretch the histogram to full black/white. Ported from plotterfun's
 * autocontrast helper (MIT); this rescues low-contrast phone photos before
 * thresholding or dithering. */
export function autoLevels(gray, cutoff = 0.005) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < gray.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(gray[i])));
    hist[v]++;
  }
  const target = cutoff * gray.length;
  let low = 0;
  let high = 255;
  let acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc > target) { low = i; break; }
  }
  acc = 0;
  for (let i = 255; i >= 0; i--) {
    acc += hist[i];
    if (acc > target) { high = i; break; }
  }
  if (high - low < 8) return gray;
  const scale = 255 / (high - low);
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    out[i] = Math.max(0, Math.min(255, (gray[i] - low) * scale));
  }
  return out;
}

/* Brightness / contrast / gamma, matching the order used by LaserWeb4 and
 * LaserGRBL before thresholding. */
export function applyTone(gray, { brightness = 0, contrast = 0, gamma = 1 } = {}) {
  if (!brightness && !contrast && (!gamma || gamma === 1)) return gray;
  const cf = contrast ? (259 * (contrast + 255)) / (255 * (259 - contrast)) : 1;
  const invGamma = gamma && gamma !== 1 ? 1 / gamma : 1;
  const out = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) {
    let v = gray[i] + brightness;
    if (contrast) v = cf * (v - 128) + 128;
    v = Math.max(0, Math.min(255, v));
    if (invGamma !== 1) v = 255 * Math.pow(v / 255, invGamma);
    out[i] = v;
  }
  return out;
}

/* Rough image classification used to choose a sensible conversion mode.
 * Photos and gradients contain many mid-grey pixels; logos and line art are
 * almost entirely black or white. */
export function imageToneInfo(img) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const width = 96;
  const height = Math.max(8, Math.round((width * ih) / iw));
  const { gray } = imageToGray(img, width, height);
  let dark = 0, mid = 0, light = 0;
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i];
    if (v < 48) dark++;
    else if (v > 208) light++;
    else mid++;
  }
  const n = Math.max(1, gray.length);
  return { dark: dark / n, mid: mid / n, light: light / n };
}

export function boxBlur(gray, width, height, radius) {
  if (!radius || radius < 1) return gray;
  const r = Math.round(radius);
  const tmp = new Float32Array(gray.length);
  const out = new Float32Array(gray.length);
  const w = 2 * r + 1;

  for (let y = 0; y < height; y++) {
    let sum = 0;
    const row = y * width;
    for (let x = -r; x <= r; x++) sum += gray[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = sum / w;
      const add = row + Math.min(width - 1, x + r + 1);
      const sub = row + Math.max(0, x - r);
      sum += gray[add] - gray[sub];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / w;
      const add = Math.min(height - 1, y + r + 1) * width + x;
      const sub = Math.max(0, y - r) * width + x;
      sum += tmp[add] - tmp[sub];
    }
  }
  return out;
}

/* Remove isolated dark pixels (JPEG speckles) before contour tracing. */
export function despeckle(mask, width, height) {
  const out = mask.slice();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let n = 0;
      if (x > 0 && mask[i - 1]) n++;
      if (x + 1 < width && mask[i + 1]) n++;
      if (y > 0 && mask[i - width]) n++;
      if (y + 1 < height && mask[i + width]) n++;
      if (n === 0) out[i] = 0;
    }
  }
  return out;
}

/* threshold: 0..255. Higher values make more pixels dark (the intuitive
 * direction). The same offset is used as an exposure bias when dithering. */
export function makeMask(gray, width, height, { threshold = 128, invert = false, dither = false, ordered = false } = {}) {
  const bias = 128 - threshold;
  const buf = new Float32Array(gray.length);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.max(0, Math.min(255, gray[i] + bias));

  if (ordered) {
    const BAYER = [
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5]
    ];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const t = ((BAYER[y % 4][x % 4] + 0.5) / 16) * 255;
        buf[i] = buf[i] < t ? 0 : 255;
      }
    }
  } else if (dither) {
    for (let y = 0; y < height; y++) {
      const reverse = y % 2 === 1;
      for (let k = 0; k < width; k++) {
        const x = reverse ? width - 1 - k : k;
        const i = y * width + x;
        const old = buf[i];
        const nv = old < 128 ? 0 : 255;
        const err = old - nv;
        buf[i] = nv;
        const spread = (dx, dy, f) => {
          const nx = x + dx;
          if (nx < 0 || nx >= width || y + dy >= height) return;
          buf[(y + dy) * width + nx] += err * f;
        };
        if (reverse) {
          spread(-1, 0, 7 / 16);
          spread(1, 1, 3 / 16);
          spread(0, 1, 5 / 16);
          spread(-1, 1, 1 / 16);
        } else {
          spread(1, 0, 7 / 16);
          spread(-1, 1, 3 / 16);
          spread(0, 1, 5 / 16);
          spread(1, 1, 1 / 16);
        }
      }
    }
  }

  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) {
    const dark = dither ? buf[i] < 128 : buf[i] < 128;
    mask[i] = invert ? (dark ? 0 : 1) : (dark ? 1 : 0);
  }
  return mask;
}

/* Target pixel grid for raster output. */
export function rasterGrid(img, targetWidthMm, spacingMm, maxCells = 90000) {
  let w = Math.max(8, Math.round(targetWidthMm / Math.max(0.2, spacingMm)));
  let h = Math.max(8, Math.round((w * img.height) / img.width));
  // Scale both axes together. The old loop only shrank w, so an extreme
  // aspect ratio could get stuck at w = 8 and spin forever.
  if (w * h > maxCells) {
    const s = Math.sqrt(maxCells / (w * h));
    w = Math.max(8, Math.floor(w * s));
    h = Math.max(8, Math.floor(h * s));
  }
  return { w, h, cell: targetWidthMm / w };
}

function findRuns(isDark, length, bridge) {
  const runs = [];
  let start = -1;
  let last = -1;
  for (let i = 0; i < length; i++) {
    if (isDark(i)) {
      if (start < 0) start = i;
      last = i;
    } else if (start >= 0 && i - last - 1 > bridge) {
      runs.push([start, last]);
      start = -1;
    }
  }
  if (start >= 0) runs.push([start, last]);
  return runs;
}

/* Link runs in adjacent rows/columns when their spans overlap. This is the
 * same idea as GRBL-Plotter's DrawColorMap: keep the pen down and zig-zag
 * through a solid area instead of lifting for every raster run. Overlap is
 * required so the connector stays inside the dark area and does not smear
 * dithered photos. */
function linkRuns(groups) {
  const paths = [];
  const used = groups.map((g) => g.map(() => false));

  for (let g = 0; g < groups.length; g++) {
    for (let i = 0; i < groups[g].length; i++) {
      if (used[g][i]) continue;
      const first = groups[g][i];
      used[g][i] = true;
      const pts = [first.p1, first.p2];
      let cur = first.p2;
      let span = first;
      let gi = g;

      while (gi + 1 < groups.length) {
        const next = groups[gi + 1];
        let best = -1;
        let bestD = Infinity;
        let bestFlip = false;

        for (let j = 0; j < next.length; j++) {
          if (used[gi + 1][j]) continue;
          const n = next[j];
          const overlap = Math.min(span.a2, n.a2) - Math.max(span.a1, n.a1);
          const minW = Math.min(span.a2 - span.a1, n.a2 - n.a1);
          if (overlap < minW * 0.5) continue;
          const d1 = Math.hypot(n.p1.x - cur.x, n.p1.y - cur.y);
          const d2 = Math.hypot(n.p2.x - cur.x, n.p2.y - cur.y);
          if (Math.min(d1, d2) < bestD) {
            bestD = Math.min(d1, d2);
            best = j;
            bestFlip = d2 < d1;
          }
        }

        if (best < 0) break;
        const n = next[best];
        const start = bestFlip ? n.p2 : n.p1;
        const end = bestFlip ? n.p1 : n.p2;
        pts.push(start, end);
        used[gi + 1][best] = true;
        cur = end;
        span = n;
        gi++;
      }

      paths.push({ points: pts, closed: false });
    }
  }
  return paths;
}

export function rasterPaths(mask, width, height, cell, { mode = 'scan', bridge = 0, oneWay = false, connectRows = true } = {}) {
  if (mode === 'dots') {
    // Artistic stippling: one short vertical stroke per dark cell.
    const paths = [];
    const len = Math.max(0.2, cell * 0.37);
    const yOf = (row) => (height - row - 0.5) * cell;
    for (let row = 0; row < height; row++) {
      const y = yOf(row);
      const reverse = row % 2 === 1;
      for (let k = 0; k < width; k++) {
        const col = reverse ? width - 1 - k : k;
        if (!mask[row * width + col]) continue;
        const x = (col + 0.5) * cell;
        paths.push({ points: [{ x, y: y - len }, { x, y: y + len }], closed: false });
      }
    }
    return paths;
  }

  if (mode === 'columns') {
    const groups = [];
    const separate = [];
    for (let col = 0; col < width; col++) {
      const x = (col + 0.5) * cell;
      const reverse = !oneWay && col % 2 === 1;
      const runs = findRuns((row) => mask[row * width + col], height, bridge);
      if (reverse) runs.reverse();
      if (!connectRows) {
        for (const [a, b] of runs) {
          const top = (height - a) * cell;
          const bottom = (height - b - 1) * cell;
          const pts = reverse ? [{ x, y: bottom }, { x, y: top }] : [{ x, y: top }, { x, y: bottom }];
          separate.push({ points: pts, closed: false });
        }
        continue;
      }
      groups.push(runs.map(([a, b]) => {
        const top = (height - a) * cell;
        const bottom = (height - b - 1) * cell;
        const lo = Math.min(top, bottom);
        const hi = Math.max(top, bottom);
        return reverse
          ? { p1: { x, y: bottom }, p2: { x, y: top }, a1: lo, a2: hi }
          : { p1: { x, y: top }, p2: { x, y: bottom }, a1: lo, a2: hi };
      }));
    }
    return connectRows ? linkRuns(groups) : separate;
  }

  // scan (default): horizontal rows
  const groups = [];
  const separate = [];
  const yOf = (row) => (height - row - 0.5) * cell;
  for (let row = 0; row < height; row++) {
    const y = yOf(row);
    const reverse = !oneWay && row % 2 === 1;
    const runs = findRuns((col) => mask[row * width + col], width, bridge);
    if (reverse) runs.reverse();
    if (!connectRows) {
      for (const [a, b] of runs) {
        const x1 = a * cell;
        const x2 = (b + 1) * cell;
        const pts = reverse ? [{ x: x2, y }, { x: x1, y }] : [{ x: x1, y }, { x: x2, y }];
        separate.push({ points: pts, closed: false });
      }
      continue;
    }
    groups.push(runs.map(([a, b]) => {
      const x1 = a * cell;
      const x2 = (b + 1) * cell;
      return reverse
        ? { p1: { x: x2, y }, p2: { x: x1, y }, a1: x1, a2: x2 }
        : { p1: { x: x1, y }, p2: { x: x2, y }, a1: x1, a2: x2 };
    }));
  }
  return connectRows ? linkRuns(groups) : separate;
}

/* Vector outlines from a photo/logo. */
export function traceImage(img, opts) {
  const {
    targetWidthMm = 100,
    maxPixels = 520,
    threshold = 128,
    invert = false,
    blur = 1,
    autoContrast = true,
    brightness = 0,
    contrast = 0,
    gamma = 1,
    simplifyMm = 0.2
  } = opts;

  const scale = Math.min(1, maxPixels / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const { gray } = imageToGray(img, w, h);
  const leveled = autoContrast ? autoLevels(gray) : gray;
  const toned = applyTone(leveled, { brightness, contrast, gamma });
  const blurred = boxBlur(toned, w, h, blur);
  const mask = makeMask(blurred, w, h, { threshold, invert, dither: false });

  const cell = targetWidthMm / w;
  const epsPx = Math.max(0.15, simplifyMm / cell);
  // Remove isolated JPEG speckles before tracing; 3 px minimum length then
  // removes the remaining tiny slivers.
  const cleanMask = despeckle(mask, w, h);
  const raw = traceMask(cleanMask, w, h, { simplify: epsPx, minLength: 3 });

  const paths = raw.map((p) => {
    let pts = p.points.map((pt) => ({ x: pt.x * cell, y: (h - pt.y) * cell }));
    if (p.closed && pts.length > 2) pts.push(pts[0]);
    return { points: pts, closed: p.closed };
  });

  return { paths, width: targetWidthMm, height: h * cell };
}

/* Raster modes from an image. */
export function rasterizeImage(img, opts) {
  const {
    targetWidthMm = 100,
    spacingMm = 1,
    mode = 'scan',
    threshold = 128,
    invert = false,
    blur = 1,
    dither = false,
    ordered = false,
    bridge = 0,
    oneWay = false,
    connectRows = true,
    autoContrast = true,
    brightness = 0,
    contrast = 0,
    gamma = 1,
    maxCells = 90000
  } = opts;

  const { w, h, cell } = rasterGrid(img, targetWidthMm, spacingMm, maxCells);
  const { gray } = imageToGray(img, w, h);
  const leveled = autoContrast ? autoLevels(gray) : gray;
  const toned = applyTone(leveled, { brightness, contrast, gamma });
  const blurred = boxBlur(toned, w, h, blur);
  const mask = makeMask(blurred, w, h, { threshold, invert, dither, ordered });
  // Run-linking is for solid fills. On dithered output it would join runs
  // across white gaps and turn the image into a few long zig-zags.
  const linkRows = (dither || ordered) ? false : connectRows;
  const paths = rasterPaths(mask, w, h, cell, { mode, bridge, oneWay, connectRows: linkRows });

  return { paths, width: targetWidthMm, height: h * cell, cells: w * h, grid: { w, h, cell } };
}

/* Continuous-line "squiggle" raster, adapted from mitxela/plotterfun (MIT).
 * One wavy line per row. Dark pixels get a larger amplitude and a faster
 * oscillation, so the image appears as a dense sketch. Unlike dithering,
 * this produces one long path per row instead of hundreds of tiny strokes,
 * which suits a slow pen plotter with backlash. */
export function squiggleImage(img, opts) {
  const {
    targetWidthMm = 100,
    lines = 60,
    amount = 1.5,
    detail = 150,
    threshold = 128,
    invert = false,
    blur = 1,
    autoContrast = true,
    brightness = 0,
    contrast = 0,
    gamma = 1,
    maxPixels = 640
  } = opts;

  const scale = Math.min(1, maxPixels / Math.max(img.width, img.height));
  const w = Math.max(16, Math.round(img.width * scale));
  const h = Math.max(16, Math.round(img.height * scale));
  const { gray } = imageToGray(img, w, h);
  const leveled = autoContrast ? autoLevels(gray) : gray;
  const toned = applyTone(leveled, { brightness, contrast, gamma });
  const blurred = boxBlur(toned, w, h, blur);
  const cell = targetWidthMm / w;

  const lineCount = Math.max(4, Math.round(lines));
  const yStep = Math.max(1, Math.round(h / lineCount));
  const amp = Math.max(0.1, amount);
  const freq = Math.max(5, detail);
  // Keep the wave inside its row band. Plotterfun's original amplitude is tied
  // to the line count, which overlaps rows on small images and turns the plot
  // into a solid scribble.
  const amplitudePx = amp * Math.max(0.75, yStep * 0.8);
  const cutoff = 6;
  const paths = [];

  for (let y = 0; y < h; y += yStep) {
    let a = 0;
    let pts = [];
    for (let x = 0; x < w; x++) {
      let grayV = blurred[y * w + x];
      if (invert) grayV = 255 - grayV;
      // threshold 128 = neutral; higher threshold = darker drawing.
      const z = Math.max(0, Math.min(255, 127 + threshold - grayV));
      if (z < cutoff) {
        if (pts.length > 1) paths.push({ points: pts, closed: false });
        pts = [];
        a = 0;
        continue;
      }
      const r = amplitudePx * (z / 255);
      a += z / freq;
      const yy = y + Math.sin(a) * r;
      pts.push({ x: x * cell, y: (h - yy) * cell });
    }
    if (pts.length > 1) paths.push({ points: pts, closed: false });
  }

  return { paths, width: targetWidthMm, height: h * cell, lines: lineCount };
}

/* Simple built-in demo drawing so the app can be tried without a file. */
export function demoImage() {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 640, 480);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(200, 220, 110, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(330, 330);
  ctx.bezierCurveTo(380, 120, 500, 120, 540, 330);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(420, 90);
  ctx.lineTo(420, 380);
  ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 70px sans-serif';
  ctx.fillText('PLOT', 90, 430);
  return canvas;
}
