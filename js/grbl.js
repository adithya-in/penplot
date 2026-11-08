/* High-level GRBL operations used by the UI. */

import { profileToSettings } from './settings.js';

const F = (n, d = 3) => Number(n).toFixed(d);

export async function readSettings(serial) {
  const lines = await serial.collect('$$', 10000);
  const map = {};
  for (const line of lines) {
    const m = line.match(/^\$(\d+)=([-\d.]+)/);
    if (m) map[Number(m[1])] = Number(m[2]);
  }
  return map;
}

export async function applyProfile(serial, profile, onProgress) {
  const settings = profileToSettings(profile);
  const entries = Object.entries(settings);
  try {
    await serial.sendLine('$X', 5000);
  } catch { /* alarm lock may already be clear */ }
  let i = 0;
  for (const [key, value] of entries) {
    const text = Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    await serial.sendLine(`$${key}=${text}`, 8000);
    i++;
    onProgress?.(i, entries.length);
  }
  return settings;
}

export function unlock(serial) {
  return serial.sendLine('$X');
}

export function zeroAll(serial) {
  return serial.sendLine('G10 L20 P1 X0 Y0 Z0');
}

export function zeroXY(serial) {
  return serial.sendLine('G10 L20 P1 X0 Y0');
}

export async function goHome(serial) {
  return serial.sendLine('$H', 60000);
}

export async function jog(serial, axis, distance, feed) {
  const cmd = `$J=G91 ${axis}${F(distance)} F${F(feed, 0)}`;
  return serial.sendLine(cmd, 30000);
}

/* A pen move is sent as one G-code line. Keeping G21/G90 on the same line
 * avoids a second "ok" round-trip that used to fail with "Another command is
 * still waiting for ok" when the button was clicked twice. */
export async function penUp(serial, profile, block = true) {
  const z = profile.pen.up;
  const rate = profile.pen.feed;
  const cmd = block
    ? `G21 G90 G1 Z${F(z)} F${F(rate, 0)}`
    : `G21 G90 G0 Z${F(z)}`;
  return serial.sendLine(cmd, 30000);
}

export async function penDown(serial, profile) {
  const z = profile.pen.down;
  const rate = profile.pen.feed;
  return serial.sendLine(`G21 G90 G1 Z${F(z)} F${F(rate, 0)}`, 30000);
}

export async function setWorkPosition(serial, axis, value = 0) {
  return serial.sendLine(`G10 L20 P1 ${axis}${F(value)}`);
}

export async function queryPosition(serial) {
  const st = serial.lastStatus;
  return st?.mpos || st?.wpos || null;
}

export function statusText(st) {
  if (!st) return 'Idle';
  const names = {
    Idle: 'Idle', Run: 'Drawing', Jog: 'Jogging', Hold: 'Paused',
    Door: 'Door open', Home: 'Homing', Alarm: 'ALARM', Check: 'Check', Sleep: 'Sleep'
  };
  return names[st.state] || st.state;
}
