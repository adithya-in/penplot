/* PenPlot — UI state machine.
 *
 * Flow: source (image / SVG / text) → stroke paths → clamped toolpath →
 * G-code → Web Serial streaming to GRBL.
 *
 * Everything here is plain ES modules; there is no build step and no server
 * logic. Web Serial needs a secure context: HTTPS (including the Vercel
 * deployment) or http://localhost.
 */

import { GrblSerial } from './serial.js';
import { Preview } from './preview.js';
import {
  DEFAULT_PROFILE,
  loadProfile,
  saveProfile,
  loadDrawSettings,
  saveDrawSettings,
  settingsToProfile,
  fmtTime
} from './settings.js';
import * as GRBL from './grbl.js';
import { loadImageFile, traceImage, rasterizeImage, demoImage } from './image.js';
import { parseSvg } from './svg.js';
import { textToPaths } from './font.js';
import { cleanPaths, buildGcode, checkBounds } from './gcode.js';
import { optimizePaths, twoOpt } from './pathopt.js';
import { simplifyPolyline } from './trace.js';

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

let profile = loadProfile();
const draw = loadDrawSettings();

const serial = new GrblSerial();
const preview = new Preview($('preview'));

const state = {
  source: 'image',
  paths: [],
  gcode: null,
  stats: null,
  issues: [],
  generating: false,
  genId: 0,
  streaming: false,
  paused: false,
  connected: false,
  machineBusy: false
};

let imageEl = null;
let imageName = '';
let svgText = '';
let svgName = '';
let genTimer = null;
let countdownTimer = null;
let simResetTimer = null;

const MAX_CONSOLE_LINES = 400;
const logEl = $('console');

/* ────────────────────────────── helpers ────────────────────────────── */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function numValue(id, fallback = 0) {
  const v = Number($(id).value);
  return Number.isFinite(v) ? v : fallback;
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ` ${kind}` : '');
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7500 : 4800);
}

function logLine(text, cls = '') {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  el.textContent = text || '\u00a0';
  logEl.appendChild(el);
  while (logEl.childElementCount > MAX_CONSOLE_LINES) logEl.firstElementChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}

function setProgress(pct, text) {
  $('progressBar').style.width = `${clamp(pct, 0, 100)}%`;
  if (text !== undefined) $('progressText').textContent = text;
}

function showModal(id) {
  $(id).classList.remove('hidden');
}

function hideModal(id) {
  $(id).classList.add('hidden');
}

function isModalOpen(id) {
  return !$(id).classList.contains('hidden');
}

function formatLength(mm) {
  if (!Number.isFinite(mm)) return '—';
  if (mm >= 1000) return `${(mm / 1000).toFixed(2)} m`;
  if (mm >= 100) return `${mm.toFixed(0)} mm`;
  return `${mm.toFixed(1)} mm`;
}

function boundsLabel(b) {
  return `X ${b.minX.toFixed(1)}…${b.maxX.toFixed(1)} mm · Y ${b.minY.toFixed(1)}…${b.maxY.toFixed(1)} mm`;
}

function translatePaths(paths, dx, dy) {
  if (!dx && !dy) return paths;
  return paths.map((path) => ({
    ...path,
    points: path.points.map((p) => ({ x: p.x + dx, y: p.y + dy }))
  }));
}

/* Keep every coordinate inside the paper rectangle. The stock machine has no
 * limit switches, so this is the safety net that stops a bad offset from
 * commanding an unbounded move. Returns changed=true when anything clipped. */
function clampPaths(paths, work) {
  let changed = false;
  const clamped = paths.map((path) => {
    const points = path.points.map((p) => {
      let x = p.x;
      let y = p.y;
      if (x < 0) { x = 0; changed = true; }
      else if (x > work.x) { x = work.x; changed = true; }
      if (y < 0) { y = 0; changed = true; }
      else if (y > work.y) { y = work.y; changed = true; }
      return { ...p, x, y };
    });
    return { ...path, points };
  });
  return { paths: clamped, changed };
}

/* ─────────────────────────── input binding ─────────────────────────── */

function syncDrawInputs() {
  $('imageMode').value = draw.imageMode || 'trace';
  $('imgWidth').value = draw.imgWidth;
  $('threshold').value = draw.threshold;
  $('blur').value = draw.blur;
  $('spacing').value = draw.spacing;
  $('simplify').value = draw.simplify;
  $('bridge').value = draw.bridge;
  $('invert').checked = Boolean(draw.invert);
  $('dither').checked = Boolean(draw.dither);
  $('autoDraw').checked = draw.autoDraw !== false;
  $('imgOffsetX').value = draw.imgOffsetX;
  $('imgOffsetY').value = draw.imgOffsetY;

  $('svgWidth').value = draw.svgWidth;
  $('svgTol').value = draw.svgTol;
  $('svgOffsetX').value = draw.svgOffsetX;
  $('svgOffsetY').value = draw.svgOffsetY;

  $('textInput').value = draw.text;
  $('fontSize').value = draw.fontSize;
  $('letterSpace').value = draw.letterSpace;
  $('lineSpace').value = draw.lineSpace;
  $('textAlign').value = draw.textAlign;
  $('textAngle').value = draw.textAngle;
  $('textOffsetX').value = draw.textOffsetX;
  $('textOffsetY').value = draw.textOffsetY;
}

function readDrawInputs() {
  draw.imageMode = $('imageMode').value;
  draw.imgWidth = clamp(numValue('imgWidth', 100), 10, profile.work.x);
  draw.threshold = clamp(numValue('threshold', 128), 0, 255);
  draw.blur = clamp(numValue('blur', 1), 0, 4);
  draw.spacing = clamp(numValue('spacing', 1), 0.2, 5);
  draw.simplify = clamp(numValue('simplify', 0.2), 0.01, 3);
  draw.bridge = clamp(numValue('bridge', 0), 0, 10);
  draw.invert = $('invert').checked;
  draw.dither = $('dither').checked;
  draw.autoDraw = $('autoDraw').checked;
  draw.imgOffsetX = numValue('imgOffsetX', 0);
  draw.imgOffsetY = numValue('imgOffsetY', 0);

  draw.svgWidth = clamp(numValue('svgWidth', 100), 10, profile.work.x);
  draw.svgTol = clamp(numValue('svgTol', 0.15), 0, 2);
  draw.svgOffsetX = numValue('svgOffsetX', 0);
  draw.svgOffsetY = numValue('svgOffsetY', 0);

  draw.text = $('textInput').value;
  draw.fontSize = clamp(numValue('fontSize', 12), 1, 100);
  draw.letterSpace = clamp(numValue('letterSpace', 1.2), -5, 20);
  draw.lineSpace = clamp(numValue('lineSpace', 1.7), 0.8, 4);
  draw.textAlign = $('textAlign').value;
  draw.textAngle = clamp(numValue('textAngle', 0), -180, 180);
  draw.textOffsetX = numValue('textOffsetX', 0);
  draw.textOffsetY = numValue('textOffsetY', 0);

  saveDrawSettings(draw);
}

function updateLabels() {
  $('vImgWidth').textContent = draw.imgWidth;
  $('vThreshold').textContent = draw.threshold;
  $('vBlur').textContent = draw.blur;
  $('vSpacing').textContent = Number(draw.spacing).toFixed(1);
  $('vSimplify').textContent = Number(draw.simplify).toFixed(2);
  $('vBridge').textContent = draw.bridge;
  $('vSvgWidth').textContent = draw.svgWidth;
  $('vSvgTol').textContent = Number(draw.svgTol).toFixed(2);
  $('vFontSize').textContent = draw.fontSize;
  $('vLetterSpace').textContent = Number(draw.letterSpace).toFixed(1);
  $('vLineSpace').textContent = Number(draw.lineSpace).toFixed(1);
  $('vTextAngle').textContent = draw.textAngle;
}

function applyModeVisibility() {
  const trace = $('imageMode').value === 'trace';
  $$('.raster-only').forEach((el) => el.classList.toggle('hidden', trace));
  $$('.trace-only').forEach((el) => el.classList.toggle('hidden', !trace));
}

function regenOn(id, eventName = 'input') {
  const el = $(id);
  if (!el) return;
  el.addEventListener(eventName, () => {
    readDrawInputs();
    updateLabels();
    applyModeVisibility();
    scheduleGenerate();
  });
}

function bindDrawControls() {
  [
    'imgWidth', 'threshold', 'blur', 'spacing', 'simplify', 'bridge',
    'imgOffsetX', 'imgOffsetY'
  ].forEach((id) => regenOn(id));

  ['invert', 'dither'].forEach((id) => regenOn(id, 'change'));
  regenOn('imageMode', 'change');

  $('autoDraw').addEventListener('change', () => {
    draw.autoDraw = $('autoDraw').checked;
    saveDrawSettings(draw);
  });

  ['svgWidth', 'svgTol', 'svgOffsetX', 'svgOffsetY'].forEach((id) => regenOn(id));
  [
    'textInput', 'fontSize', 'letterSpace', 'lineSpace', 'textAlign',
    'textAngle', 'textOffsetX', 'textOffsetY'
  ].forEach((id) => regenOn(id));
  $('textAlign').addEventListener('change', () => {
    readDrawInputs();
    scheduleGenerate(0);
  });
}

/* ───────────────────────────── profile UI ───────────────────────────── */

function setNum(id, value) {
  $(id).value = round(value, 3);
}

function syncProfileInputs() {
  setNum('setWorkX', profile.work.x);
  setNum('setWorkY', profile.work.y);
  setNum('setStepsX', profile.steps.x);
  setNum('setStepsY', profile.steps.y);
  setNum('setStepsZ', profile.steps.z);
  setNum('setRateX', profile.maxRate.x);
  setNum('setRateY', profile.maxRate.y);
  setNum('setAccelX', profile.accel.x);
  setNum('setAccelY', profile.accel.y);
  setNum('setPenUp', profile.pen.up);
  setNum('setPenDown', profile.pen.down);
  setNum('setPenFeed', profile.pen.feed);
  setNum('setDrawFeed', profile.feed.draw);
  setNum('setTravelFeed', profile.feed.travel);
  $('setKeepOn').checked = Boolean(profile.keepMotorsOn);
  $('setSoftLimits').checked = Boolean(profile.softLimits);
  $('setHoming').checked = Boolean(profile.homing);
  $('setInvertX').checked = Boolean(profile.invertMask & 1);
  $('setInvertY').checked = Boolean(profile.invertMask & 2);
  $('setInvertZ').checked = Boolean(profile.invertMask & 4);
}

function readProfileInputs() {
  profile.work.x = clamp(numValue('setWorkX', 150), 10, 2000);
  profile.work.y = clamp(numValue('setWorkY', 150), 10, 2000);
  profile.steps.x = clamp(numValue('setStepsX', 51.2), 0.01, 10000);
  profile.steps.y = clamp(numValue('setStepsY', 51.2), 0.01, 10000);
  profile.steps.z = clamp(numValue('setStepsZ', 100), 0.01, 10000);
  profile.maxRate.x = clamp(numValue('setRateX', 300), 1, 100000);
  profile.maxRate.y = clamp(numValue('setRateY', 300), 1, 100000);
  profile.accel.x = clamp(numValue('setAccelX', 50), 0.1, 10000);
  profile.accel.y = clamp(numValue('setAccelY', 50), 0.1, 10000);
  profile.pen.up = numValue('setPenUp', 5);
  profile.pen.down = numValue('setPenDown', 0);
  profile.pen.feed = clamp(numValue('setPenFeed', 200), 1, 10000);
  profile.feed.draw = clamp(numValue('setDrawFeed', 250), 1, 100000);
  profile.feed.travel = clamp(numValue('setTravelFeed', 300), 1, 100000);
  profile.keepMotorsOn = $('setKeepOn').checked;
  profile.softLimits = $('setSoftLimits').checked;
  profile.homing = $('setHoming').checked;
  profile.invertMask =
    ($('setInvertX').checked ? 1 : 0) |
    ($('setInvertY').checked ? 2 : 0) |
    ($('setInvertZ').checked ? 4 : 0);

  // Soft limits only make sense if the travel matches the paper area.
  profile.travel.x = profile.work.x;
  profile.travel.y = profile.work.y;

  if (profile.pen.up <= profile.pen.down) {
    profile.pen.up = profile.pen.down + 1;
    setNum('setPenUp', profile.pen.up);
  }
  saveProfile(profile);
}

function bindProfileControls() {
  ['setWorkX', 'setWorkY', 'setStepsX', 'setStepsY', 'setStepsZ',
    'setRateX', 'setRateY', 'setAccelX', 'setAccelY', 'setPenUp',
    'setPenDown', 'setPenFeed', 'setDrawFeed', 'setTravelFeed',
    'setKeepOn', 'setSoftLimits', 'setHoming',
    'setInvertX', 'setInvertY', 'setInvertZ'].forEach((id) => {
    $(id).addEventListener('change', () => {
      readProfileInputs();
      preview.profile = profile;
      preview.render();
      if (state.paths.length) {
        rebuildCurrent();
        updateBounds(checkBoundsProjected());
      }
      if (id.startsWith('setInvert') && serial.connected) {
        toast('Direction saved. Press Apply to send it to the Nano.', 'warn');
      }
    });
  });

  $('btnApply').addEventListener('click', applyProfileToMachine);
  $('btnRefresh').addEventListener('click', refreshFromMachine);
  $('btnResetProfile').addEventListener('click', resetProfile);
}

function resetProfile() {
  if (!window.confirm('Reset the machine profile to the built-in defaults?')) return;
  profile = JSON.parse(JSON.stringify(DEFAULT_PROFILE));
  saveProfile(profile);
  syncProfileInputs();
  preview.setData(state.paths, profile);
  rebuildCurrent();
  updateBounds(checkBoundsProjected());
  toast('Machine profile reset.');
}

async function applyProfileToMachine() {
  readProfileInputs();
  syncProfileInputs();
  preview.profile = profile;
  preview.render();
  rebuildCurrent();

  if (!serial.connected) {
    toast('Profile saved on this computer. Connect the Nano to write it to the controller.');
    return;
  }
  if (state.streaming) {
    toast('Stop the current drawing before changing settings.', 'warn');
    return;
  }

  setProgress(0, 'applying settings…');
  try {
    const settings = await GRBL.applyProfile(serial, profile, (i, total) => {
      setProgress((i / total) * 100, `applying ${i}/${total}`);
    });
    setProgress(0, 'settings applied');
    logLine(`[settings] wrote ${Object.keys(settings).length} GRBL settings`, 'ok');
    toast('Machine profile written to the Nano.');
  } catch (err) {
    setProgress(0, 'apply failed');
    toast(`Could not apply settings: ${err.message}`, 'err');
  }
}

async function refreshFromMachine() {
  if (!serial.connected) {
    toast('Connect the Nano first.', 'warn');
    return;
  }
  if (state.streaming) return;
  try {
    serial.writeRaw('?').catch(() => {});
    const map = await GRBL.readSettings(serial);
    profile = settingsToProfile(map, profile);
    saveProfile(profile);
    syncProfileInputs();
    preview.profile = profile;
    preview.setData(state.paths, profile);
    rebuildCurrent();
    updateBounds(checkBoundsProjected());
    toast('Controller settings loaded into the panel.');
  } catch (err) {
    toast(`Could not read settings: ${err.message}`, 'err');
  }
}

/* ─────────────────────────── path generation ─────────────────────────── */

function scheduleGenerate(delay = 240) {
  clearTimeout(genTimer);
  genTimer = setTimeout(() => { generate(); }, delay);
}

function nextFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function setGenerating(busy) {
  state.generating = busy;
  updateDrawButton();
  if (busy) $('progressText').textContent = 'generating…';
}

function clearToolpath(message = 'idle') {
  state.paths = [];
  state.gcode = null;
  state.stats = null;
  state.issues = [];
  preview.setData([], profile);
  updateStats(null);
  updateBounds([]);
  setProgress(0, message);
  updateDrawButton();
}

async function generate({ auto = false } = {}) {
  if (state.streaming) return;
  const id = ++state.genId;
  readProfileInputs();
  readDrawInputs();
  updateLabels();
  applyModeVisibility();
  setGenerating(true);
  await nextFrame();
  if (id !== state.genId) return;

  let rawPaths = [];
  try {
    if (state.source === 'image') {
      if (!imageEl) {
        setGenerating(false);
        clearToolpath('upload an image');
        return;
      }
      const opts = {
        targetWidthMm: Math.min(draw.imgWidth, profile.work.x),
        threshold: draw.threshold,
        invert: draw.invert,
        blur: draw.blur
      };
      if (draw.imageMode === 'trace') {
        rawPaths = traceImage(imageEl, {
          ...opts,
          simplifyMm: draw.simplify
        }).paths;
      } else {
        rawPaths = rasterizeImage(imageEl, {
          ...opts,
          spacingMm: draw.spacing,
          mode: draw.imageMode,
          dither: draw.dither,
          bridge: draw.bridge
        }).paths;
      }
      rawPaths = translatePaths(rawPaths, draw.imgOffsetX, draw.imgOffsetY);
      rawPaths = cleanPaths(rawPaths);
      rawPaths = optimizePaths(rawPaths, { x: 0, y: 0 });
      rawPaths = twoOpt(rawPaths, { x: 0, y: 0 });
    } else if (state.source === 'svg') {
      if (!svgText) {
        setGenerating(false);
        clearToolpath('open an SVG');
        return;
      }
      const parsed = parseSvg(svgText, { targetWidth: Math.min(draw.svgWidth, profile.work.x) });
      rawPaths = parsed.paths;
      if (draw.svgTol > 0) {
        rawPaths = rawPaths.map((path) => {
          const pts = simplifyPolyline(path.points, draw.svgTol);
          return { ...path, points: pts.length > 1 ? pts : path.points };
        });
      }
      rawPaths = translatePaths(rawPaths, draw.svgOffsetX, draw.svgOffsetY);
      rawPaths = cleanPaths(rawPaths);
      rawPaths = optimizePaths(rawPaths, { x: 0, y: 0 });
      rawPaths = twoOpt(rawPaths, { x: 0, y: 0 });
    } else {
      if (!draw.text.trim()) {
        setGenerating(false);
        clearToolpath('type something to write');
        return;
      }
      const laid = textToPaths(draw.text, {
        size: draw.fontSize,
        letterSpace: draw.letterSpace,
        lineSpace: draw.lineSpace,
        align: draw.textAlign,
        angle: draw.textAngle
      });
      rawPaths = translatePaths(laid.paths, draw.textOffsetX, draw.textOffsetY);
      rawPaths = cleanPaths(rawPaths);
      // Keep natural reading order for text; optimising would jump around.
    }
  } catch (err) {
    if (id === state.genId) {
      setGenerating(false);
      clearToolpath('error');
      toast(`Could not generate the toolpath: ${err.message}`, 'err');
    }
    return;
  }

  if (id !== state.genId) return;

  const rawCheck = checkBounds(rawPaths, profile);
  const paper = clampPaths(rawPaths, profile.work);
  let paths = cleanPaths(paper.paths);

  // Clamping can collapse paths that were entirely outside the paper.
  paths = paths.filter((p) => p.points.length > 1);

  if (!paths.length) {
    setGenerating(false);
    clearToolpath('nothing inside the paper');
    toast('The drawing ended up outside the paper. Check the offsets.', 'warn');
    return;
  }

  const issues = rawCheck.issues.slice();
  if (paper.changed) issues.unshift('Toolpath was clamped to the paper edge');

  let gcode;
  try {
    gcode = buildGcode(paths, profile);
  } catch (err) {
    setGenerating(false);
    clearToolpath('error');
    toast(`Could not build G-code: ${err.message}`, 'err');
    return;
  }

  state.paths = paths;
  state.gcode = gcode;
  state.stats = gcode.stats;
  state.issues = issues;

  preview.setData(paths, profile);
  updateStats(gcode.stats);
  updateBounds(issues);
  setGenerating(false);
  setProgress(0, `${paths.length} paths ready`);
  updateDrawButton();

  if (auto) maybeAutoDraw();
}

function rebuildCurrent() {
  if (!state.paths.length) {
    updateStats(null);
    return;
  }
  try {
    state.gcode = buildGcode(state.paths, profile);
    state.stats = state.gcode.stats;
    updateStats(state.stats);
  } catch {
    /* keep the previous g-code if the profile is mid-edit */
  }
}

function checkBoundsProjected() {
  const check = checkBounds(state.paths, profile);
  const clamped = state.issues.filter((s) => typeof s === 'string' && s.includes('clamped'));
  return [...check.issues, ...clamped];
}

function updateStats(stats) {
  const count = state.paths.length;
  $('statPaths').textContent = count || '—';
  $('statLength').textContent = stats && count ? formatLength(stats.drawDist) : '—';
  $('statLifts').textContent = stats && count ? stats.lifts : '—';
  $('statTime').textContent = stats && count ? fmtTime(stats.time) : '—';
}

function updateBounds(issues) {
  const list = Array.isArray(issues) ? issues : issues?.issues;
  state.issues = Array.isArray(list) ? list : [];
  const warn = $('boundsWarn');
  warn.classList.toggle('hidden', !state.issues.length);
  warn.textContent = state.issues.length
    ? `⚠ ${state.issues[0]}${state.issues.length > 1 ? ` +${state.issues.length - 1}` : ''}`
    : '';
  warn.title = state.issues.join('\n');
}

function updateDrawButton() {
  const ready = state.paths.length > 0 && Boolean(state.gcode) && !state.generating && !state.streaming;
  const btn = $('btnDraw');
  btn.disabled = !ready || !serial.connected;
  btn.title = !serial.connected
    ? 'Connect the Nano to draw'
    : ready ? 'Start drawing' : 'Generate a toolpath first';

  $('btnExport').disabled = !state.paths.length || state.streaming;
  $('btnSimulate').disabled = !state.paths.length || state.streaming;
  $('btnGenerate').disabled = state.streaming;
}

/* ─────────────────────────── source switching ─────────────────────────── */

function setSource(next) {
  state.source = next;
  $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === next));
  ['image', 'svg', 'text'].forEach((name) => {
    $(`pane-${name}`).classList.toggle('hidden', name !== next);
  });

  if (preview.isSimulating()) {
    preview.onProgress = null;
    preview.onDone = null;
    preview.stopSimulation();
    $('btnSimulate').textContent = 'Simulate';
    setProgress(0, 'idle');
  }

  if (next === 'image' && !imageEl) {
    clearToolpath('upload an image');
    return;
  }
  if (next === 'svg' && !svgText) {
    clearToolpath('open an SVG');
    return;
  }
  generate();
}

function wireTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      if (state.streaming) return;
      if (tab.dataset.tab === state.source) return;
      readDrawInputs();
      setSource(tab.dataset.tab);
    });
  });
}

/* ─────────────────────────── file loading ─────────────────────────── */

function wireDrop(dropId, inputId, onFile) {
  const drop = $(dropId);
  const input = $(inputId);
  const open = () => input.click();

  drop.addEventListener('click', open);
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file) onFile(file);
  });

  ['dragenter', 'dragover'].forEach((type) => {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add('over');
    });
  });
  ['dragleave', 'dragend', 'drop'].forEach((type) => {
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove('over');
    });
  });
  drop.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}

async function handleImageFile(file) {
  if (state.streaming) {
    toast('Stop the current drawing before loading a new image.', 'warn');
    return;
  }
  if (/svg/i.test(file.type) || /\.svg$/i.test(file.name)) {
    await handleSvgFile(file);
    return;
  }
  if (!/^image\//.test(file.type)) {
    toast('That file is not an image.', 'err');
    return;
  }
  try {
    const image = await loadImageFile(file);
    imageEl = image;
    imageName = file.name;
    $('imgInfo').textContent = `${file.name} · ${image.width}×${image.height}`;
    if (state.source !== 'image') {
      state.source = 'image';
      $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'image'));
      ['image', 'svg', 'text'].forEach((name) => $('pane-' + name).classList.toggle('hidden', name !== 'image'));
    }
    await generate({ auto: true });
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function handleSvgFile(file) {
  if (state.streaming) {
    toast('Stop the current drawing before opening an SVG.', 'warn');
    return;
  }
  try {
    svgText = await file.text();
    svgName = file.name;
    $('svgInfo').textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} kB`;
    if (state.source !== 'svg') {
      state.source = 'svg';
      $$('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'svg'));
      ['image', 'svg', 'text'].forEach((name) => $('pane-' + name).classList.toggle('hidden', name !== 'svg'));
    }
    await generate();
  } catch (err) {
    toast(`Could not read the SVG: ${err.message}`, 'err');
  }
}

function wireFiles() {
  wireDrop('dropImage', 'fileImage', handleImageFile);
  wireDrop('dropSvg', 'fileSvg', handleSvgFile);

  $('btnDemo').addEventListener('click', async () => {
    if (state.streaming) {
      toast('Stop the current drawing first.', 'warn');
      return;
    }
    try {
      imageEl = demoImage();
      imageName = 'demo';
      $('imgInfo').textContent = 'demo drawing · 640×480';
      if (state.source !== 'image') setSource('image');
      else await generate({ auto: true });
    } catch (err) {
      toast(`Could not create the demo: ${err.message}`, 'err');
    }
  });

  document.addEventListener('paste', async (event) => {
    if (state.streaming) return;
    const item = Array.from(event.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (file) await handleImageFile(file);
  });
}

/* ─────────────────────────── confirmation + draw ─────────────────────────── */

function maybeAutoDraw() {
  if (!draw.autoDraw) return;
  if (!serial.connected) {
    toast('Toolpath ready. Connect the Nano, then press Draw.', 'warn');
    return;
  }
  if (!state.paths.length) return;
  openConfirm({ auto: state.issues.length === 0 });
}

function openConfirm({ auto = false } = {}) {
  const stats = state.stats;
  const canAuto = auto && state.issues.length === 0;
  const body = $('confirmBody');

  const rows = [
    ['Paper', `${profile.work.x} × ${profile.work.y} mm`],
    ['Paths', String(state.paths.length)],
    ['Draw length', formatLength(stats?.drawDist || 0)],
    ['Pen lifts', String(stats?.lifts || 0)],
    ['Estimated', fmtTime(stats?.time || 0)],
    ['Feed', `${profile.feed.draw} mm/min`]
  ];

  body.innerHTML = rows
    .map(([key, value]) => `<div><span>${key}</span><b>${value}</b></div>`)
    .join('');

  if (state.issues.length) {
    const warning = document.createElement('div');
    warning.className = 'callout warn';
    warning.style.gridColumn = '1 / -1';
    warning.textContent = `⚠ ${state.issues.join(' · ')}`;
    body.appendChild(warning);
  }

  const start = $('btnConfirmStart');
  start.textContent = canAuto ? 'Start in 5…' : 'Start drawing';
  showModal('modalConfirm');
  clearCountdown();

  if (canAuto) {
    let remaining = 5;
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearCountdown();
        startDrawing();
      } else {
        start.textContent = `Start in ${remaining}…`;
      }
    }, 1000);
  }
}

function clearCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

async function startDrawing() {
  clearCountdown();
  hideModal('modalConfirm');

  if (!serial.connected) {
    toast('Connect the Nano before drawing.', 'err');
    return;
  }
  if (state.streaming || !state.paths.length || !state.gcode) return;

  // If the connect-time $I query or a jog is still waiting for its "ok",
  // starting now would collide and the first streamed line would fail.
  if (serial.busy || ['Run', 'Jog', 'Home'].includes(serial.state)) {
    setProgress(0, 'waiting for controller…');
    if (!(await waitForIdle(10000))) {
      setProgress(0, 'idle');
      toast('The controller is busy. Try drawing again in a moment.', 'warn');
      return;
    }
  }

  // Re-check against the current paper size one last time. This catches the
  // case where the user edited Settings after generating the toolpath.
  readProfileInputs();
  const clamped = clampPaths(state.paths, profile.work);
  if (clamped.changed) {
    const next = cleanPaths(clamped.paths).filter((p) => p.points.length > 1);
    if (!next.length) {
      clearToolpath('nothing inside the paper');
      toast('The toolpath no longer fits the paper. Fix the offsets or paper size.', 'err');
      return;
    }
    state.paths = next;
    state.gcode = buildGcode(next, profile);
    state.stats = state.gcode.stats;
    preview.setData(next, profile);
    updateStats(state.stats);
    toast('Toolpath clamped to the new paper size.', 'warn');
  } else {
    rebuildCurrent();
  }

  if (preview.isSimulating()) {
    preview.onProgress = null;
    preview.onDone = null;
    preview.stopSimulation();
    $('btnSimulate').textContent = 'Simulate';
  }

  state.streaming = true;
  state.paused = false;
  setDrawingUI(true);
  setProgress(0, 'unlocking…');

  try {
    try {
      await GRBL.unlock(serial);
    } catch {
      /* the controller may not be in an alarm */
    }
    setProgress(0, 'lifting pen…');
    await GRBL.penUp(serial, profile, true);

    const lines = state.gcode.lines;
    await serial.stream(lines, {
      onProgress: (done, total) => {
        const pct = (done / total) * 100;
        setProgress(pct, `drawing ${Math.round(pct)}% · ${done}/${total}`);
      },
      shouldStop: () => !state.streaming
    });

    setProgress(100, 'drawing complete');
    toast('Drawing complete. The pen is up.');
  } catch (err) {
    const message = String(err?.message || err);
    logLine(`[draw] ${message}`, 'err');
    if (/stopped|abort/i.test(message)) {
      setProgress(0, 'stopped');
      toast('Stopped. Lift the pen and check the paper.', 'warn');
    } else {
      setProgress(0, 'stopped');
      toast(`Drawing stopped: ${message}`, 'err');
    }
  } finally {
    state.streaming = false;
    state.paused = false;
    setDrawingUI(false);
    updateDrawButton();
  }
}

function setDrawingUI(active) {
  const left = document.querySelector('.panel.left');
  if (left) left.inert = active;
  $('btnDraw').classList.toggle('hidden', active);
  $('btnStop').classList.toggle('hidden', !active);
  $('btnPause').classList.toggle('hidden', !active);
  $('btnPause').textContent = 'Pause';
  $('btnSimulate').disabled = active || !state.paths.length;
  $('btnExport').disabled = active || !state.paths.length;
  $('btnGenerate').disabled = active;
  $$('.tab').forEach((tab) => { tab.disabled = active; });
  updateMachineControls();
}

async function stopDrawing() {
  if (!state.streaming) return;
  state.streaming = false;
  state.paused = false;
  serial.stopStream();

  try { await serial.pause(); } catch { /* ignore */ }
  serial.abortPending(new Error('Stopped'));

  // A soft reset clears the planner and any queued moves. GRBL re-announces
  // itself a moment later; we then lift the pen off the paper.
  setTimeout(async () => {
    if (state.streaming) return;
    try { serial.reset(); } catch { /* ignore */ }
    setTimeout(async () => {
      if (!serial.connected || state.streaming) return;
      try { await GRBL.penUp(serial, profile, true); } catch { /* ignore */ }
    }, 1400);
  }, 60);

  setProgress(0, 'stopped');
}

async function togglePause() {
  if (!state.streaming) return;
  try {
    if (!state.paused) {
      await serial.pause();
      state.paused = true;
      $('btnPause').textContent = 'Resume';
      setProgress(Number.parseFloat($('progressBar').style.width) || 0, 'paused');
    } else {
      await serial.resume();
      state.paused = false;
      $('btnPause').textContent = 'Pause';
      setProgress(Number.parseFloat($('progressBar').style.width) || 0, 'drawing…');
    }
  } catch (err) {
    toast(`Could not change pause state: ${err.message}`, 'err');
  }
}

/* ─────────────────────────── simulation / export ─────────────────────────── */

function toggleSimulation() {
  if (state.streaming) return;

  if (preview.isSimulating()) {
    preview.onProgress = null;
    preview.onDone = null;
    preview.stopSimulation();
    $('btnSimulate').textContent = 'Simulate';
    setProgress(0, 'idle');
    return;
  }

  if (!state.paths.length) {
    toast('Generate a toolpath first.', 'warn');
    return;
  }

  clearTimeout(simResetTimer);
  preview.onProgress = (p) => {
    if (state.streaming) return;
    setProgress(p * 100, p < 1 ? `simulating ${Math.round(p * 100)}%` : 'simulation done');
  };
  preview.onDone = () => {
    $('btnSimulate').textContent = 'Simulate';
    if (!state.streaming) {
      simResetTimer = setTimeout(() => {
        if (!state.streaming && !preview.isSimulating()) setProgress(0, 'idle');
      }, 1600);
    }
  };

  const seconds = clamp(8 + Math.log10(1 + (state.stats?.drawDist || 0)) * 2, 8, 24);
  const started = preview.startSimulation(seconds);
  if (!started) {
    toast('Nothing to simulate.', 'warn');
    return;
  }
  $('btnSimulate').textContent = 'Stop sim';
  toast('Simulation only — the motors stay still.');
}

function exportGcode() {
  if (!state.gcode) {
    toast('Generate a toolpath first.', 'warn');
    return;
  }
  const blob = new Blob([state.gcode.text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `penplot-${stamp}.gcode`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('G-code exported.');
}

/* ─────────────────────────── connection / status ─────────────────────────── */

function setConnectedUI(connected) {
  state.connected = connected;
  $('connDot').className = 'dot' + (connected ? ' on' : '');
  $('connText').textContent = connected ? 'Connected' : 'Not connected';
  $('connDetail').textContent = connected ? '115200 baud · GRBL' : 'Chrome / Edge · Web Serial';
  $('btnConnect').classList.toggle('hidden', connected);
  $('btnDisconnect').classList.toggle('hidden', !connected);

  if (!connected) {
    $('machineState').textContent = 'Offline';
    $('machineState').className = 'pill';
    preview.setMachine(null);
  }
  updateMachineControls();
  updateDrawButton();
}

function updateMachineControls() {
  const busy = state.machineBusy || ['Run', 'Jog', 'Home'].includes(serial.state);
  const on = serial.connected && !state.streaming && !busy;
  $$('.jog').forEach((btn) => { btn.disabled = !on; });
  ['btnZero', 'btnRefresh', 'btnPenUp', 'btnPenDown', 'btnHome', 'btnApply'].forEach((id) => {
    $(id).disabled = !on;
  });
  // Unlock must stay available so an alarm can be cleared.
  $('btnUnlock').disabled = !serial.connected || state.streaming;
  $('cmdInput').disabled = !on;
  const send = $('cmdForm').querySelector('button');
  if (send) send.disabled = !on;
}

function setConnecting(on) {
  const btn = $('btnConnect');
  btn.disabled = on;
  btn.textContent = on ? 'Connecting…' : 'Connect Nano';
}

async function connect() {
  if (!GrblSerial.supported()) {
    $('browserWarning').classList.remove('hidden');
    toast('This browser cannot talk to serial ports. Use Chrome or Edge.', 'err');
    return;
  }
  setConnecting(true);
  try {
    await serial.requestAndConnect();
    toast('Connected. If the machine ignores moves, press Apply to load the profile.');
  } catch (err) {
    if (err.name === 'NotFoundError') toast('No serial port selected.', 'warn');
    else toast(`Could not open the port: ${err.message}`, 'err');
  } finally {
    setConnecting(false);
  }
}

async function disconnect() {
  try {
    if (state.streaming) await stopDrawing();
    await serial.disconnect();
    toast('Disconnected.');
  } catch (err) {
    toast(`Could not disconnect cleanly: ${err.message}`, 'err');
  }
}

function wireSerial() {
  serial.addEventListener('connected', () => {
    setConnectedUI(true);
    logLine('[connected] Web Serial open at 115200', 'ok');
    // Ask for build info; harmless if this fork does not implement $I.
    setTimeout(async () => {
      if (!serial.connected) return;
      try {
        await serial.collect('$I', 4000);
      } catch { /* optional */ }
    }, 600);
  });

  serial.addEventListener('disconnected', (event) => {
    const reason = typeof event.detail === 'string' ? event.detail : 'port closed';
    logLine(`[disconnected] ${reason}`, 'err');
    if (state.streaming) {
      state.streaming = false;
      state.paused = false;
      setDrawingUI(false);
      setProgress(0, 'disconnected');
    }
    setConnectedUI(false);
    toast(`Disconnected: ${reason}`, 'warn');
  });

  serial.addEventListener('status', (event) => {
    const st = event.detail;
    const pos = st.mpos || st.wpos;
    if (pos) {
      $('posX').textContent = pos[0].toFixed(2);
      $('posY').textContent = pos[1].toFixed(2);
      $('posZ').textContent = pos[2].toFixed(2);

      const now = performance.now();
      if (!preview._lastMachine || now - preview._lastMachine > 220) {
        preview._lastMachine = now;
        preview.setMachine({ x: pos[0], y: pos[1], z: pos[2] });
      }
      if (isModalOpen('modalCalib')) $('calCurZ').textContent = pos[2].toFixed(2);
    }

    const pill = $('machineState');
    pill.textContent = GRBL.statusText(st);
    pill.className = 'pill' + (
      st.state === 'Run' || st.state === 'Jog' ? ' run' :
      st.state === 'Alarm' ? ' alarm' : ''
    );
    updateMachineControls();
  });

  serial.addEventListener('line', (event) => {
    const line = event.detail;
    if (!line) return;
    if (line.startsWith('<')) return;      // status spam
    if (line === 'ok' || line.startsWith('ok ')) return;
    logLine(line);
  });

  serial.addEventListener('tx', (event) => {
    if (!state.streaming) logLine(`> ${event.detail}`, 'tx');
  });

  serial.addEventListener('firmware', (event) => {
    logLine(`[controller] ${event.detail}`, 'ok');
  });

  serial.addEventListener('message', (event) => {
    logLine(event.detail);
    if (/reset/i.test(event.detail)) toast('The controller reset.', 'warn');
  });

  serial.addEventListener('grbl-error', (event) => {
    logLine(event.detail, 'err');
  });

  serial.addEventListener('alarm', (event) => {
    logLine(event.detail, 'err');
    toast(`Controller alarm: ${event.detail}`, 'err');
    const pill = $('machineState');
    pill.textContent = 'ALARM';
    pill.className = 'pill alarm';
  });

  serial.addEventListener('transport-error', (event) => {
    const message = event.detail?.message || String(event.detail);
    logLine(`[transport] ${message}`, 'err');
  });
}

/* ─────────────────────────── machine buttons ─────────────────────────── */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* A jog returns "ok" before the carriage stops. Waiting for the status poll to
 * report Idle avoids GRBL's "error:9 (G-code locked out during jog)". */
async function waitForIdle(timeout = 12000) {
  const started = Date.now();
  while (serial.busy || ['Run', 'Jog', 'Home'].includes(serial.state)) {
    if (Date.now() - started > timeout) return false;
    await sleep(120);
  }
  return true;
}

async function withSerial(label, action, { allowAlarm = false } = {}) {
  if (!serial.connected) {
    toast('Connect the Nano first.', 'warn');
    return;
  }
  if (state.streaming) {
    toast('Stop the drawing first.', 'warn');
    return;
  }
  if (state.machineBusy || serial.busy) {
    toast('Wait for the current move to finish.', 'warn');
    return;
  }
  if (serial.state === 'Alarm' && !allowAlarm) {
    toast('The controller is in ALARM. Press Unlock first.', 'err');
    return;
  }

  state.machineBusy = true;
  updateMachineControls();
  try {
    if (serial.state !== 'Alarm' && !(await waitForIdle())) {
      toast('The machine is still moving. Try again in a moment.', 'warn');
      return;
    }
    await action();
  } catch (err) {
    const message = String(err?.message || err);
    if (/error:9|alarm|locked/i.test(message)) {
      toast(`${label}: the controller is locked. Press Unlock, then try again.`, 'err');
    } else if (/another command/i.test(message)) {
      toast('Wait for the current move to finish.', 'warn');
    } else {
      toast(`${label}: ${message}`, 'err');
    }
  } finally {
    state.machineBusy = false;
    updateMachineControls();
  }
}

async function jog(axis, direction) {
  const step = Number($('jogStep').value) || 1;
  const delta = direction === '+' ? step : -step;
  await withSerial('Jog failed', () => GRBL.jog(serial, axis, delta, profile.feed.travel));
}

function wireMachine() {
  $$('.jog').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [axis, sign] = btn.dataset.jog;
      jog(axis, sign);
    });
  });

  $('btnZero').addEventListener('click', () => withSerial('Zero failed', async () => {
    await GRBL.zeroAll(serial);
    logLine('[zero] work origin set to the current position', 'ok');
    toast('Zeroed X, Y and Z at the current position.');
  }));

  $('btnUnlock').addEventListener('click', () => withSerial('Unlock failed', async () => {
    await GRBL.unlock(serial);
    toast('Alarm lock cleared.');
  }, { allowAlarm: true }));

  $('btnPenUp').addEventListener('click', () => withSerial('Pen up failed', () => GRBL.penUp(serial, profile, true)));
  $('btnPenDown').addEventListener('click', () => withSerial('Pen down failed', () => GRBL.penDown(serial, profile)));

  $('btnHome').addEventListener('click', () => {
    if (!profile.homing) {
      toast('Homing is off. This plotter has no limit switches — use Zero here instead.', 'warn');
      return;
    }
    withSerial('Homing failed', () => GRBL.goHome(serial));
  });

  $('btnStop').addEventListener('click', stopDrawing);
  $('btnPause').addEventListener('click', togglePause);

  $('btnConnect').addEventListener('click', connect);
  $('btnDisconnect').addEventListener('click', disconnect);

  $('btnDraw').addEventListener('click', () => {
    if (!serial.connected) {
      toast('Connect the Nano first.', 'warn');
      return;
    }
    if (!state.paths.length) {
      toast('Generate a toolpath first.', 'warn');
      return;
    }
    openConfirm();
  });

  $('btnSimulate').addEventListener('click', toggleSimulation);
  $('btnExport').addEventListener('click', exportGcode);
  $('btnGenerate').addEventListener('click', () => generate());
}

/* ─────────────────────────── console ─────────────────────────── */

function wireConsole() {
  $('btnClearConsole').addEventListener('click', () => {
    logEl.textContent = '';
    logLine('[console] cleared');
  });

  $('cmdForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('cmdInput');
    const line = input.value.trim();
    if (!line) return;
    input.value = '';

    if (!serial.connected) {
      toast('Connect the Nano first.', 'warn');
      return;
    }

    try {
      if (line === '?') {
        await serial.writeRaw('?');
        return;
      }
      if (line === '!') {
        await serial.pause();
        logLine('> !', 'tx');
        return;
      }
      if (line === '~') {
        await serial.resume();
        logLine('> ~', 'tx');
        return;
      }

      const multi = line === '$$' || line === '$#' || line === '$I' || line === '$G';
      if (multi) {
        await serial.collect(line, 12000);
      } else {
        const timeout = line.startsWith('$H') ? 60000 : 30000;
        await serial.sendLine(line, timeout);
      }
    } catch (err) {
      toast(`Command failed: ${err.message}`, 'err');
    }
  });
}

/* ─────────────────────────── calibration ─────────────────────────── */

function openCalibration() {
  $('calWorkX').value = round(profile.work.x, 2);
  $('calWorkY').value = round(profile.work.y, 2);
  const pos = serial.lastStatus?.mpos || serial.lastStatus?.wpos;
  $('calCurZ').textContent = pos ? pos[2].toFixed(2) : '—';
  showModal('modalCalib');
}

function currentZ() {
  const pos = serial.lastStatus?.mpos || serial.lastStatus?.wpos;
  return pos ? pos[2] : null;
}

function applyCalibration(axis) {
  const measured = numValue(`calMeasured${axis.toUpperCase()}`, 10);
  if (!(measured > 0)) {
    toast('Enter a measured distance greater than zero.', 'err');
    return;
  }
  const key = axis;
  profile.steps[key] = round(profile.steps[key] * (10 / measured), 3);
  saveProfile(profile);
  syncProfileInputs();
  rebuildCurrent();
  toast(`${axis.toUpperCase()} calibrated to ${profile.steps[key]} steps/mm. Press Apply to write it.`);
}

function wireCalibration() {
  $('btnCalib').addEventListener('click', openCalibration);
  $('calApplyX').addEventListener('click', () => applyCalibration('x'));
  $('calApplyY').addEventListener('click', () => applyCalibration('y'));

  $('calDown').addEventListener('click', () => {
    const z = currentZ();
    if (z === null) {
      toast('No position report yet. Connect and jog Z first.', 'warn');
      return;
    }
    profile.pen.down = round(z, 2);
    if (profile.pen.up <= profile.pen.down) profile.pen.up = profile.pen.down + 1;
    saveProfile(profile);
    syncProfileInputs();
    rebuildCurrent();
    toast(`Pen DOWN captured at Z${profile.pen.down} mm.`);
  });

  $('calUp').addEventListener('click', () => {
    const z = currentZ();
    if (z === null) {
      toast('No position report yet. Connect and jog Z first.', 'warn');
      return;
    }
    profile.pen.up = round(z, 2);
    if (profile.pen.up <= profile.pen.down) profile.pen.down = profile.pen.up - 1;
    saveProfile(profile);
    syncProfileInputs();
    rebuildCurrent();
    toast(`Pen UP captured at Z${profile.pen.up} mm.`);
  });

  $('calSave').addEventListener('click', () => {
    profile.work.x = clamp(numValue('calWorkX', profile.work.x), 10, 2000);
    profile.work.y = clamp(numValue('calWorkY', profile.work.y), 10, 2000);
    profile.travel.x = profile.work.x;
    profile.travel.y = profile.work.y;
    saveProfile(profile);
    syncProfileInputs();
    preview.setData(state.paths, profile);
    rebuildCurrent();
    updateBounds(checkBoundsProjected());
    toast('Calibration saved. Press Apply to write it to the controller.');
  });
}

/* ─────────────────────────── misc modals ─────────────────────────── */

function wireModals() {
  $('btnHelp').addEventListener('click', () => showModal('modalHelp'));

  $$('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.close;
      hideModal(target);
      if (target === 'modalConfirm') clearCountdown();
    });
  });

  $$('.modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target !== modal) return;
      modal.classList.add('hidden');
      if (modal.id === 'modalConfirm') clearCountdown();
    });
  });

  $('btnCancelConfirm').addEventListener('click', () => {
    clearCountdown();
    hideModal('modalConfirm');
  });

  $('btnConfirmStart').addEventListener('click', () => {
    clearCountdown();
    startDrawing();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $$('.modal').forEach((modal) => modal.classList.add('hidden'));
      clearCountdown();
    }
  });
}

/* ─────────────────────────── boot ─────────────────────────── */

function boot() {
  if (!GrblSerial.supported()) {
    $('browserWarning').classList.remove('hidden');
    $('btnConnect').disabled = true;
    $('connDetail').textContent = 'Web Serial unavailable — use Chrome or Edge';
  }

  syncDrawInputs();
  syncProfileInputs();
  updateLabels();
  applyModeVisibility();

  preview.setData([], profile);
  updateStats(null);
  updateBounds([]);
  updateDrawButton();
  setConnectedUI(false);
  setProgress(0, 'idle');

  bindDrawControls();
  bindProfileControls();
  wireTabs();
  wireFiles();
  wireSerial();
  wireMachine();
  wireConsole();
  wireCalibration();
  wireModals();

  // Try to reopen a port the user has already granted. Never prompt on load.
  if (GrblSerial.supported()) {
    setTimeout(async () => {
      const ok = await serial.autoConnect();
      if (ok) toast('Reconnected to the Nano.');
    }, 500);
  }

  window.addEventListener('beforeunload', (event) => {
    if (!state.streaming) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

boot();
