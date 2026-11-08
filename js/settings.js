/* Machine profile + persisted user settings.
 * All machine units are millimetres, feeds are mm/min.
 */

const PROFILE_KEY = 'plotter.profile.v1';
const PROFILE_REV_KEY = 'plotter.profile.rev';
const PROFILE_REV = 3;
const DRAW_KEY = 'plotter.draw.v1';
const PORT_KEY = 'plotter.port.v1';

export const DEFAULT_PROFILE = {
  name: 'Mini CNC Plotter (28BYJ-48)',
  work: { x: 150, y: 150 },        // usable paper area, mm
  steps: { x: 51.2, y: 51.2, z: 100 }, // steps/mm (calibrate!)
  maxRate: { x: 600, y: 600, z: 200 }, // mm/min (jog/travel cap)
  accel: { x: 50, y: 50, z: 100 },     // mm/s^2
  travel: { x: 150, y: 150, z: 15 },   // soft-limit travel, mm
  pen: { up: 5, down: 0, feed: 200, dwell: 0.2, zOffset: 0 },
  feed: { draw: 250, travel: 300, jog: 600 },
  softLimits: false,
  homing: false,
  // $3 direction mask: bit 0 = X, bit 1 = Y, bit 2 = Z. The Y motor on this
  // plotter is mounted in reverse, so Y must be inverted for the image to
  // come out the right way up.
  invertMask: 1 << 1,
  keepMotorsOn: true,
  returnHome: false
};

export const DRAW_DEFAULTS = {
  // image
  imageMode: 'trace',   // trace | scan | columns | dots
  threshold: 128,
  invert: false,
  blur: 1,
  autoContrast: true,  // stretch the histogram before thresholding
  brightness: 0,       // -100..100
  contrast: 0,         // -100..100
  gamma: 1,            // 0.2..3 (1 = neutral)
  dither: false,
  ordered: false,
  connectRows: true,
  spacing: 1.0,         // mm between raster lines
  simplify: 0.2,        // mm
  bridge: 0,            // merge gaps up to N cells
  oneWay: false,        // raster rows always left-to-right (no serpentine)
  imageFeed: 150,       // mm/min for image G-code (text/SVG keep Draw feed)
  squiggleLines: 50,    // rows for the continuous squiggle mode
  squiggleAmount: 1.2,  // wave amplitude
  squiggleDetail: 6,    // wavelength in mm
  imgWidth: 100,        // mm
  imgOffsetX: 0,
  imgOffsetY: 0,
  // svg
  svgWidth: 100,
  svgOffsetX: 0,
  svgOffsetY: 0,
  svgTol: 0.15,
  // text
  text: 'HELLO',
  fontSize: 12,
  letterSpace: 1.2,
  lineSpace: 1.7,
  textAlign: 'left',
  textOffsetX: 10,
  textOffsetY: 40,
  textAngle: 0,
  // safety / workflow
  autoDraw: true,
  modeAuto: true
};

function merge(base, extra) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!extra || typeof extra !== 'object') return out;
  for (const [k, v] of Object.entries(extra)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = merge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function read(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / file:// – ignore */
  }
}

export function loadProfile() {
  const stored = read(PROFILE_KEY);
  const profile = merge(DEFAULT_PROFILE, stored);
  // Revision 2: the reference plotter's Y motor is mounted in reverse. Older
  // saves wrote invertMask 0 even though the user never chose it, so migrate
  // that stale value once. A deliberate X/Z inversion is kept.
  const rev = Number(read(PROFILE_REV_KEY)) || 0;
  if (rev < 2) {
    if (!stored || stored.invertMask === undefined || stored.invertMask === 0) {
      profile.invertMask = DEFAULT_PROFILE.invertMask;
      write(PROFILE_KEY, profile);
    }
  }
  // Revision 3: faster jog. The old default capped X/Y at 300 mm/min, which
  // also capped every jog. Raise the cap once and add a dedicated jog feed.
  if (rev < 3) {
    if (!stored || !stored.maxRate || !(stored.maxRate.x > 300)) profile.maxRate.x = 600;
    if (!stored || !stored.maxRate || !(stored.maxRate.y > 300)) profile.maxRate.y = 600;
    if (!stored || !stored.feed || stored.feed.jog === undefined) profile.feed.jog = 600;
    write(PROFILE_KEY, profile);
  }
  if (rev < PROFILE_REV) write(PROFILE_REV_KEY, PROFILE_REV);
  return profile;
}

export function saveProfile(profile) {
  write(PROFILE_KEY, profile);
}

export function loadDrawSettings() {
  const merged = merge(DRAW_DEFAULTS, read(DRAW_KEY));
  // Older builds stored a raw pixel frequency (e.g. 90). It is now a
  // wavelength in mm and must stay in the 2-20 mm range.
  if (merged.squiggleDetail > 20) {
    merged.squiggleDetail = DRAW_DEFAULTS.squiggleDetail;
    write(DRAW_KEY, merged);
  }
  return merged;
}

export function saveDrawSettings(settings) {
  write(DRAW_KEY, settings);
}

export function loadPortHint() {
  return read(PORT_KEY) || null;
}

export function savePortHint(port) {
  if (!port) return;
  const info = port.getInfo ? port.getInfo() : {};
  write(PORT_KEY, info);
}

/* Convert the UI profile into GRBL $$ settings. */
export function profileToSettings(p) {
  return {
    1: p.keepMotorsOn ? 255 : 25,  // stepper idle lock time
    3: p.invertMask,               // direction invert mask
    10: 1,                         // status report mask: machine position
    11: 0.05,                      // junction deviation
    13: 0,                         // report inches: off
    20: p.softLimits ? 1 : 0,      // soft limits
    21: 0,                         // hard limits
    22: p.homing ? 1 : 0,          // homing
    100: p.steps.x,
    101: p.steps.y,
    102: p.steps.z,
    110: p.maxRate.x,
    111: p.maxRate.y,
    112: p.maxRate.z,
    120: p.accel.x,
    121: p.accel.y,
    122: p.accel.z,
    130: p.travel.x,
    131: p.travel.y,
    132: p.travel.z
  };
}

/* Merge a $$ dump back into a profile so the UI reflects the controller. */
export function settingsToProfile(map, base = DEFAULT_PROFILE) {
  const p = merge(base, {});
  const num = (k, fallback) => {
    const v = Number(map[k]);
    return Number.isFinite(v) ? v : fallback;
  };
  p.steps = { x: num(100, p.steps.x), y: num(101, p.steps.y), z: num(102, p.steps.z) };
  p.maxRate = { x: num(110, p.maxRate.x), y: num(111, p.maxRate.y), z: num(112, p.maxRate.z) };
  p.accel = { x: num(120, p.accel.x), y: num(121, p.accel.y), z: num(122, p.accel.z) };
  p.travel = { x: num(130, p.travel.x), y: num(131, p.travel.y), z: num(132, p.travel.z) };
  if (Number.isFinite(Number(map[3]))) p.invertMask = Number(map[3]);
  if (Number.isFinite(Number(map[20]))) p.softLimits = Number(map[20]) === 1;
  if (Number.isFinite(Number(map[22]))) p.homing = Number(map[22]) === 1;
  if (Number.isFinite(Number(map[1]))) p.keepMotorsOn = Number(map[1]) === 255;
  return p;
}

export function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(r).padStart(2, '0')}s`;
  return `${r}s`;
}

export function fmtNum(n, digits = 2) {
  return Number(n).toFixed(digits);
}
