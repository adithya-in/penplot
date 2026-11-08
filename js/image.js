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

/* threshold: 0..255. Higher values make more pixels dark (the intuitive
 * direction). The same offset is used as an exposure bias when dithering. */
export function makeMask(gray, width, height, { threshold = 128, invert = false, dither = false } = {}) {
  const bias = 128 - threshold;
  const buf = new Float32Array(gray.length);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.max(0, Math.min(255, gray[i] + bias));

  if (dither) {
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
  while (w * h > maxCells) {
    w = Math.max(8, Math.round(w * 0.9));
    h = Math.max(8, Math.round((w * img.height) / img.width));
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

export function rasterPaths(mask, width, height, cell, { mode = 'scan', bridge = 0, oneWay = false } = {}) {
  const paths = [];
  const yOf = (row) => (height - row - 0.5) * cell;

  if (mode === 'dots') {
    // Artistic stippling: one short vertical stroke per dark cell.
    const len = Math.max(0.2, cell * 0.37);
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
    for (let col = 0; col < width; col++) {
      const x = (col + 0.5) * cell;
      const reverse = !oneWay && col % 2 === 1;
      const runs = findRuns((row) => mask[row * width + col], height, bridge);
      if (reverse) runs.reverse();
      for (const [a, b] of runs) {
        const top = (height - a) * cell;
        const bottom = (height - b - 1) * cell;
        const pts = reverse ? [{ x, y: bottom }, { x, y: top }] : [{ x, y: top }, { x, y: bottom }];
        paths.push({ points: pts, closed: false });
      }
    }
    return paths;
  }

  // scan (default): horizontal rows
  for (let row = 0; row < height; row++) {
    const y = yOf(row);
    const reverse = !oneWay && row % 2 === 1;
    const runs = findRuns((col) => mask[row * width + col], width, bridge);
    if (reverse) runs.reverse();
    for (const [a, b] of runs) {
      const x1 = a * cell;
      const x2 = (b + 1) * cell;
      const pts = reverse ? [{ x: x2, y }, { x: x1, y }] : [{ x: x1, y }, { x: x2, y }];
      paths.push({ points: pts, closed: false });
    }
  }
  return paths;
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
    simplifyMm = 0.2
  } = opts;

  const scale = Math.min(1, maxPixels / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const { gray } = imageToGray(img, w, h);
  const leveled = autoContrast ? autoLevels(gray) : gray;
  const blurred = boxBlur(leveled, w, h, blur);
  const mask = makeMask(blurred, w, h, { threshold, invert, dither: false });

  const cell = targetWidthMm / w;
  const epsPx = Math.max(0.15, simplifyMm / cell);
  // 3 px removes JPEG speckles and tiny isolated islands without losing
  // normal line-art detail.
  const raw = traceMask(mask, w, h, { simplify: epsPx, minLength: 3 });

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
    bridge = 0,
    oneWay = false,
    autoContrast = true,
    maxCells = 90000
  } = opts;

  const { w, h, cell } = rasterGrid(img, targetWidthMm, spacingMm, maxCells);
  const { gray } = imageToGray(img, w, h);
  const leveled = autoContrast ? autoLevels(gray) : gray;
  const blurred = boxBlur(leveled, w, h, blur);
  const mask = makeMask(blurred, w, h, { threshold, invert, dither });
  const paths = rasterPaths(mask, w, h, cell, { mode, bridge, oneWay });

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
    maxPixels = 640
  } = opts;

  const scale = Math.min(1, maxPixels / Math.max(img.width, img.height));
  const w = Math.max(16, Math.round(img.width * scale));
  const h = Math.max(16, Math.round(img.height * scale));
  const { gray } = imageToGray(img, w, h);
  const leveled = autoContrast ? autoLevels(gray) : gray;
  const blurred = boxBlur(leveled, w, h, blur);
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
