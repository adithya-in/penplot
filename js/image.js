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

/* threshold: 0..255, also used as an exposure offset for dithering. */
export function makeMask(gray, width, height, { threshold = 128, invert = false, dither = false } = {}) {
  const bias = threshold - 128;
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

export function rasterPaths(mask, width, height, cell, { mode = 'scan', bridge = 0 } = {}) {
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
      const reverse = col % 2 === 1;
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

  // scan (default): horizontal serpentine rows
  for (let row = 0; row < height; row++) {
    const y = yOf(row);
    const reverse = row % 2 === 1;
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
    simplifyMm = 0.2
  } = opts;

  const scale = Math.min(1, maxPixels / Math.max(img.width, img.height));
  const w = Math.max(8, Math.round(img.width * scale));
  const h = Math.max(8, Math.round(img.height * scale));
  const { gray } = imageToGray(img, w, h);
  const blurred = boxBlur(gray, w, h, blur);
  const mask = makeMask(blurred, w, h, { threshold, invert, dither: false });

  const cell = targetWidthMm / w;
  const epsPx = Math.max(0.15, simplifyMm / cell);
  const raw = traceMask(mask, w, h, { simplify: epsPx, minLength: 1.5 });

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
    maxCells = 90000
  } = opts;

  const { w, h, cell } = rasterGrid(img, targetWidthMm, spacingMm, maxCells);
  const { gray } = imageToGray(img, w, h);
  const blurred = boxBlur(gray, w, h, blur);
  const mask = makeMask(blurred, w, h, { threshold, invert, dither });
  const paths = rasterPaths(mask, w, h, cell, { mode, bridge });

  return { paths, width: targetWidthMm, height: h * cell, cells: w * h, grid: { w, h, cell } };
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
