// Shadow Protocol's canvas art: the facility, light, vision cones, sprites,
// the proximity scanner and the intel overlay. Drawing only; no game rules.
import { TILE, COLS, ROWS, WORLD_W, WORLD_H, MAP, ZONES, EXTRACTION, kindAt, tileAt, toTile } from './shadow-level.js';
import { LIGHT, index, wrapAngle } from './shadow-nav.js';

export const VIEW_W = 480;
export const VIEW_H = 300;
export const SCALE = 2;

export const STATE_COLORS = Object.freeze({
  patrol: '#e9dcb4', suspicious: '#ecc981', investigate: '#ecc981', alert: '#f0705e', search: '#efa58e',
  lockdown: '#c1aed5', returning: '#a5bfdc', down: '#6b6b6b', dead: '#b34a3b',
});
export const STATE_NAMES = Object.freeze({
  patrol: 'patrol', suspicious: 'suspicious', investigate: 'investigating', alert: 'alert', search: 'searching',
  lockdown: 'lockdown', returning: 'returning', down: 'unconscious', dead: 'dead',
});

const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
const zoneSector = (tx, ty) => ZONES.find(zone => (zone.rects || [zone.rect]).some(r => tx >= r[0] && tx <= r[2] && ty >= r[1] && ty <= r[3]))?.sector;

/* ── static facility ───────────────────────────────────────────────────── */

let staticCanvas = null, darkCanvas = null;

function floorTile(ctx, ch, x, y, tx, ty) {
  const n = hash(tx, ty);
  if (ch === '.' || ch === 'D' || ch === 'K') {
    ctx.fillStyle = n < .5 ? '#22262b' : '#24282d'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#1c1f23'; ctx.fillRect(x, y + TILE - .5, TILE, .5); ctx.fillRect(x + TILE - .5, y, .5, TILE);
    if (n > .86) { ctx.fillStyle = '#2b3036'; ctx.fillRect(x + 3 + n * 8, y + 5, 2, 1); }
  } else if (ch === ':') {
    ctx.fillStyle = '#2a2f35'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#353c43';
    for (let i = 1; i < TILE; i += 3) { ctx.fillRect(x + i, y, .6, TILE); ctx.fillRect(x, y + i, TILE, .6); }
  } else if (ch === '_' || ch === 'X') {
    ctx.fillStyle = n < .5 ? '#292a27' : '#2b2c29'; ctx.fillRect(x, y, TILE, TILE);
    if (n > .9) { ctx.fillStyle = '#20211f'; ctx.fillRect(x + n * 10, y + 3, .7, 7); ctx.fillRect(x + n * 10, y + 9, 4, .7); }
    if (n < .06) { ctx.fillStyle = '#323430'; ctx.fillRect(x + 4, y + 6, 3, 2); }
  } else if (ch === '=') {
    ctx.fillStyle = '#232322'; ctx.fillRect(x, y, TILE, TILE);
    if (n > .8) { ctx.fillStyle = '#1d1d1c'; ctx.fillRect(x + 2, y + n * 10, 6, .7); }
  } else if (ch === ',' || ch === '"' || ch === 'T' || ch === 'F' || ch === 'f' || ch === '~') {
    const outdoorConcrete = ty <= 30 && ch !== ',' && ch !== '"';
    ctx.fillStyle = outdoorConcrete ? '#292a27' : n < .5 ? '#1c271b' : '#1e2a1c'; ctx.fillRect(x, y, TILE, TILE);
    if (!outdoorConcrete) {
      ctx.fillStyle = '#26351f';
      for (let i = 0; i < 4; i++) ctx.fillRect(x + hash(tx + i, ty) * 15, y + hash(tx, ty + i) * 15, .8, 1.6);
    }
  } else {
    ctx.fillStyle = '#22262b'; ctx.fillRect(x, y, TILE, TILE);
  }
}

function objectTile(ctx, ch, x, y, tx, ty) {
  const n = hash(tx, ty);
  const below = tileAt(tx, ty + 1);
  const open = kindAt(tx, ty + 1).walk !== 'none' || below === 'C' || below === 'B';
  if (ch === '#') {
    ctx.fillStyle = '#3a3f46'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#464c54'; ctx.fillRect(x, y, TILE, 1.2);
    if (n > .7) { ctx.fillStyle = '#353a40'; ctx.fillRect(x + 3, y + 4, 5, .8); }
    if (open) {
      ctx.fillStyle = '#2a2e33'; ctx.fillRect(x, y + TILE - 5, TILE, 5);
      ctx.fillStyle = '#1f2226'; ctx.fillRect(x, y + TILE - 1, TILE, 1);
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x, y + TILE, TILE, 3);
    }
  } else if (ch === 'T') {
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(x + 9, y + 10, 9, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#18291b'; ctx.beginPath(); ctx.arc(x + 8, y + 8, 8.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#21381f'; ctx.beginPath(); ctx.arc(x + 7, y + 7, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2c4627'; ctx.beginPath(); ctx.arc(x + 5.5 + n * 2, y + 5.5, 2.6, 0, Math.PI * 2); ctx.fill();
  } else if (ch === 'F' || ch === 'f') {
    ctx.strokeStyle = 'rgba(126,134,142,.55)'; ctx.lineWidth = .5;
    ctx.beginPath();
    for (let i = -TILE; i < TILE; i += 3) { ctx.moveTo(x + i, y + 6); ctx.lineTo(x + i + 4, y + 10); ctx.moveTo(x + i + 4, y + 6); ctx.lineTo(x + i, y + 10); }
    if (ch === 'f') { ctx.save(); ctx.clip(new Path2D(`M${x} ${y}h5v16h-5zM${x + 11} ${y}h5v16h-5z`)); }
    ctx.stroke();
    if (ch === 'f') ctx.restore();
    ctx.fillStyle = '#6b7178'; ctx.fillRect(x, y + 5, 1.3, 6);
    ctx.fillStyle = '#585e65'; ctx.fillRect(x, y + 6, TILE, .7); ctx.fillRect(x, y + 9.5, TILE, .7);
  } else if (ch === '~') {
    ctx.fillStyle = '#0f171c'; ctx.fillRect(x + 3, y, 10, TILE);
    ctx.fillStyle = '#1b2a33'; ctx.fillRect(x + 4, y + 3 + n * 6, 4, .6);
    ctx.fillStyle = '#4b555c'; ctx.fillRect(x + 2, y, 1, TILE); ctx.fillRect(x + 13, y, 1, TILE);
  } else if (ch === 'v') {
    ctx.fillStyle = '#353c43'; ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = '#434b53'; ctx.fillRect(x + 1, y + 1, TILE - 2, 1);
    ctx.fillStyle = '#2a3036'; ctx.fillRect(x + 1, y + 7.5, TILE - 2, .7);
    ctx.fillStyle = '#56606a'; ctx.fillRect(x + 2.5, y + 2.5, .9, .9); ctx.fillRect(x + 12.5, y + 2.5, .9, .9); ctx.fillRect(x + 2.5, y + 12.5, .9, .9); ctx.fillRect(x + 12.5, y + 12.5, .9, .9);
  } else if (ch === 'C') {
    const metal = n > .62 || ty > 24;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(x + 1.5, y + 2.5, TILE, TILE);
    ctx.fillStyle = metal ? '#3f4c45' : '#6a4d2c'; ctx.fillRect(x + .5, y + .5, TILE - 1, TILE - 1);
    ctx.fillStyle = metal ? '#4d5c54' : '#7d5c35'; ctx.fillRect(x + .5, y + .5, TILE - 1, 1.2);
    ctx.fillStyle = metal ? '#34403a' : '#523b21';
    if (metal) for (let i = 2; i < TILE - 1; i += 3) ctx.fillRect(x + i, y + 1.5, .8, TILE - 3);
    else { ctx.fillRect(x + .5, y + 5.2, TILE - 1, .7); ctx.fillRect(x + .5, y + 10.4, TILE - 1, .7); ctx.fillRect(x + 7.5, y + .5, .7, TILE - 1); }
  } else if (ch === 'B') {
    const sector = zoneSector(tx, ty);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x + 1, y + 2, TILE, TILE - 2);
    if (sector === 'barracks' && ty !== 14 && ty < 20) {
      ctx.fillStyle = '#3c3a2f'; ctx.fillRect(x + .5, y + 2, TILE - 1, TILE - 4);
      ctx.fillStyle = '#5d5a48'; ctx.fillRect(x + 1.5, y + 3, TILE - 3, TILE - 6);
      if (tileAt(tx - 1, ty) !== 'B') { ctx.fillStyle = '#7d7962'; ctx.fillRect(x + 2, y + 4, 4, TILE - 8); }
    } else if (sector === 'lab') {
      ctx.fillStyle = '#3d4850'; ctx.fillRect(x + .5, y + 2, TILE - 1, TILE - 4);
      ctx.fillStyle = '#56656f'; ctx.fillRect(x + .5, y + 2, TILE - 1, 1);
      ctx.fillStyle = n > .5 ? '#5f8fa3' : '#8a8f73'; ctx.fillRect(x + 3 + n * 6, y + 5, 3, 3);
    } else {
      ctx.fillStyle = '#4a3f31'; ctx.fillRect(x + .5, y + 2, TILE - 1, TILE - 4);
      ctx.fillStyle = '#5b4e3c'; ctx.fillRect(x + .5, y + 2, TILE - 1, 1);
      if (n > .55) { ctx.fillStyle = '#8b8370'; ctx.fillRect(x + 4, y + 5, 5, 4); }
    }
  } else if (ch === 'L') {
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x + 1, y + 1.5, TILE, TILE);
    ctx.fillStyle = '#44505b'; ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 2);
    ctx.fillStyle = '#56636f'; ctx.fillRect(x + 1, y + 1, TILE - 2, 1);
    ctx.fillStyle = '#2f3840'; ctx.fillRect(x + 7.6, y + 1, .8, TILE - 2);
    for (let i = 0; i < 3; i++) { ctx.fillRect(x + 3, y + 4 + i * 1.6, 3, .6); ctx.fillRect(x + 10, y + 4 + i * 1.6, 3, .6); }
  } else if (ch === 'O') {
    ctx.fillStyle = '#28313b'; ctx.fillRect(x + .5, y + 1, TILE - 1, TILE - 3);
    ctx.fillStyle = '#3a4653'; ctx.fillRect(x + .5, y + 1, TILE - 1, 1);
  } else if (ch === 'P') {
    ctx.fillStyle = '#2d3838'; ctx.fillRect(x + 1, y + 1, TILE - 2, TILE - 3);
    ctx.fillStyle = '#3f4d4d'; ctx.fillRect(x + 1, y + 1, TILE - 2, 1);
  } else if (ch === 'D' || ch === 'K') {
    const vertical = kindAt(tx, ty - 1).walk === 'none' && kindAt(tx, ty + 1).walk === 'none';
    ctx.fillStyle = '#1a1d21';
    if (vertical) { ctx.fillRect(x + 5, y, 6, TILE); } else { ctx.fillRect(x, y + 5, TILE, 6); }
  } else if (ch === '"') {
    for (let i = 0; i < 6; i++) {
      const gx = x + hash(tx * 3 + i, ty) * 14 + 1, gy = y + hash(tx, ty * 3 + i) * 13 + 2;
      ctx.strokeStyle = i % 2 ? '#38522b' : '#2e4524'; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(gx, gy + 3); ctx.lineTo(gx - 1.4, gy - 1); ctx.moveTo(gx, gy + 3); ctx.lineTo(gx + 1.2, gy - 1.5); ctx.moveTo(gx, gy + 3); ctx.lineTo(gx, gy - 2); ctx.stroke();
    }
  }
}

function decorations(ctx) {
  // Road markings, helipad, zone signage: painted once into the static layer.
  ctx.fillStyle = 'rgba(236,201,129,.55)';
  for (let y = 25 * TILE; y < 44 * TILE; y += 14) ctx.fillRect(32 * TILE - .6, y, 1.2, 7);
  ctx.fillStyle = 'rgba(240,233,221,.35)'; ctx.fillRect(30 * TILE, 31 * TILE + 7, 4 * TILE, 1.2);
  const [x0, y0, x1, y1] = EXTRACTION.rect;
  const cx = (x0 + x1 + 1) / 2 * TILE, cy = (y0 + y1 + 1) / 2 * TILE;
  ctx.strokeStyle = 'rgba(236,201,129,.6)'; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath();
  ctx.moveTo(cx - 10, cy - 13); ctx.lineTo(cx - 10, cy + 13); ctx.moveTo(cx + 10, cy - 13); ctx.lineTo(cx + 10, cy + 13); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy); ctx.stroke();
  ctx.font = '7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(240,233,221,.22)';
  for (const [text, x, y] of [['STORAGE', 10, 16.6], ['LAB', 39.5, 4.4], ['BARRACKS', 50, 16.6], ['SECURITY', 27, 19.5], ['CHECKPOINT', 31.5, 26], ['DOCK', 8.5, 7.5]]) ctx.fillText(text, x * TILE, y * TILE);
}

export function staticLayer() {
  if (staticCanvas) return staticCanvas;
  staticCanvas = document.createElement('canvas');
  staticCanvas.width = WORLD_W * SCALE; staticCanvas.height = WORLD_H * SCALE;
  const ctx = staticCanvas.getContext('2d');
  ctx.scale(SCALE, SCALE);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) floorTile(ctx, MAP[ty][tx], tx * TILE, ty * TILE, tx, ty);
  decorations(ctx);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) objectTile(ctx, MAP[ty][tx], tx * TILE, ty * TILE, tx, ty);
  return staticCanvas;
}

export function darknessLayer() {
  if (darkCanvas) return darkCanvas;
  darkCanvas = document.createElement('canvas');
  darkCanvas.width = COLS; darkCanvas.height = ROWS;
  const ctx = darkCanvas.getContext('2d'), image = ctx.createImageData(COLS, ROWS);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const light = LIGHT[index(tx, ty)], i = (ty * COLS + tx) * 4;
    const dark = Math.max(0, Math.min(.74, (1 - light) * .8));
    image.data[i] = 4; image.data[i + 1] = 7; image.data[i + 2] = 14; image.data[i + 3] = Math.round(dark * 255);
  }
  ctx.putImageData(image, 0, 0);
  return darkCanvas;
}

/* ── vision cones ──────────────────────────────────────────────────────── */

function rayLength(sim, x, y, angle, range) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  for (let d = 4; d <= range; d += 3) {
    const tx = toTile(x + dx * d), ty = toTile(y + dy * d);
    const sight = kindAt(tx, ty).sight;
    if (sight === 'block' || (sight === 'door' && !sim.doorOpen(tx, ty))) return Math.max(0, d - 2);
  }
  return range;
}

export function conePolygon(sim, x, y, facing, halfFov, range, rays = 26) {
  const points = [[x, y]];
  for (let i = 0; i <= rays; i++) {
    const angle = facing - halfFov + (halfFov * 2) * i / rays;
    const d = rayLength(sim, x, y, angle, range);
    points.push([x + Math.cos(angle) * d, y + Math.sin(angle) * d]);
  }
  return points;
}

function fillCone(ctx, points, x, y, range, color, alpha) {
  const gradient = ctx.createRadialGradient(x, y, 2, x, y, range);
  gradient.addColorStop(0, hexAlpha(color, alpha));
  gradient.addColorStop(.75, hexAlpha(color, alpha * .45));
  gradient.addColorStop(1, hexAlpha(color, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath(); ctx.fill();
}

export function hexAlpha(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/* ── sprites ───────────────────────────────────────────────────────────── */

function drawPlayer(ctx, p, time) {
  if (p.locker) return;
  ctx.save();
  ctx.translate(p.x, p.y);
  const hidden = p.hidden === 'duct' || p.hidden === 'grass';
  ctx.globalAlpha = hidden ? .55 : 1;
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(.8, 1.6, 6.4, 5.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(p.facing);
  const crouch = p.crouch ? .82 : 1;
  ctx.scale(crouch, crouch);
  const stride = p.moving ? Math.sin(p.anim * (p.running ? 18 : 11)) * (p.running ? 3 : 2) : 0;
  ctx.fillStyle = '#15201f'; ctx.fillRect(-1 + stride, -3.4, 3, 2.2); ctx.fillRect(-1 - stride, 1.2, 3, 2.2);
  ctx.fillStyle = '#2d4b4f'; ctx.beginPath(); ctx.ellipse(0, 0, 5.4, 4.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#233b3e'; ctx.fillRect(-4.6, -2.6, 2.6, 5.2);
  ctx.fillStyle = '#3d6166'; ctx.beginPath(); ctx.ellipse(.8, -.9, 3.2, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  const sway = Math.sin(time * 7) * (p.moving ? 1.2 : .4);
  ctx.strokeStyle = '#ecc981'; ctx.lineWidth = .9;
  ctx.beginPath(); ctx.moveTo(-.5, 0); ctx.lineTo(-5.5 - (p.running ? 2 : 0), -1.4 + sway); ctx.moveTo(-.5, .4); ctx.lineTo(-5 - (p.running ? 2 : 0), 1.2 + sway * .7); ctx.stroke();
  ctx.fillStyle = '#1b2526'; ctx.beginPath(); ctx.arc(1.4, 0, 2.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ecc981'; ctx.fillRect(-.6, -.6, 3, 1.2);
  ctx.fillStyle = '#f0e9dd'; ctx.fillRect(3.4, -.6, 1, 1.2);
  // The pistol is visible only while it is out; the knife is always on the belt.
  if (time - (p.shotAt ?? -99) < .4 || p.aiming) {
    ctx.fillStyle = '#2b3336'; ctx.fillRect(3.6, .9, 5.2, 1.5);
    ctx.fillStyle = '#ecc981'; ctx.fillRect(8.5, 1.1, 1.6, 1.1);
  } else {
    ctx.strokeStyle = '#d8d2c4'; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.moveTo(3.1, 2.1); ctx.lineTo(6.4, 1.1); ctx.stroke();
  }
  ctx.restore();
}

function drawGuard(ctx, g, time, selected) {
  ctx.save();
  ctx.translate(g.x, g.y);
  ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.beginPath(); ctx.ellipse(.8, 1.8, 6.6, 5.6, 0, 0, Math.PI * 2); ctx.fill();
  if (g.dead) {
    const fall = Math.min(1, Math.max(0, (time - (g.deadAt || 0)) / .32));
    ctx.rotate(g.facing + 1.15 + (1 - fall) * .7);
    ctx.fillStyle = '#3d3229'; ctx.beginPath(); ctx.ellipse(0, 0, 7.4, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2f2821'; ctx.beginPath(); ctx.arc(6.8, .2, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#7d2a21'; ctx.fillRect(-3.5, -1.6, 2.2, 3.2);
    ctx.restore();
    return;
  }
  if (g.down) {
    ctx.rotate(g.facing + 1.2);
    ctx.fillStyle = '#4a5233'; ctx.beginPath(); ctx.ellipse(0, 0, 7, 3.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#3a4228'; ctx.beginPath(); ctx.arc(6.5, 0, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (!g.hidden) {
      ctx.fillStyle = 'rgba(193,174,213,.75)'; ctx.font = '5px monospace'; ctx.textAlign = 'center';
      const bob = (time * .8 + g.n * .3) % 1;
      ctx.globalAlpha = 1 - bob; ctx.fillText('z', g.x + 4 + bob * 3, g.y - 6 - bob * 6); ctx.globalAlpha = 1;
    }
    return;
  }
  const color = STATE_COLORS[g.state] || STATE_COLORS.patrol;
  ctx.strokeStyle = hexAlpha(color, selected ? .95 : .4); ctx.lineWidth = selected ? 1.2 : .7;
  ctx.beginPath(); ctx.ellipse(0, 1, 8, 7, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.rotate(g.facing);
  const stride = g.moving ? Math.sin(g.anim * (g.state === 'alert' ? 16 : 9)) * 2.2 : 0;
  ctx.fillStyle = '#1d2016'; ctx.fillRect(-1 + stride, -3.6, 3, 2.3); ctx.fillRect(-1 - stride, 1.3, 3, 2.3);
  ctx.fillStyle = '#56603b'; ctx.beginPath(); ctx.ellipse(0, 0, 5.8, 4.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#454d2f'; ctx.fillRect(-4.8, -2.8, 2.4, 5.6);
  ctx.strokeStyle = '#141617'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(2, 2.4); ctx.lineTo(8.6, 2.4); ctx.stroke();
  ctx.fillStyle = '#f5e6b0'; ctx.fillRect(8.4, 1.8, 1.2, 1.2);
  ctx.fillStyle = '#3c4529'; ctx.beginPath(); ctx.arc(1, 0, 3.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#525c38'; ctx.beginPath(); ctx.arc(.4, -.8, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (g.groggy > 0) { ctx.fillStyle = 'rgba(193,174,213,.8)'; ctx.font = '5px monospace'; ctx.textAlign = 'center'; ctx.fillText('~', g.x, g.y - 9); }
}

function drawIndicator(ctx, g, time) {
  if (g.down) return;
  const age = time - g.indicatorAt;
  const meter = Math.min(1, g.meter);
  if (!g.sees && meter > .04) {
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 2.6;
    ctx.beginPath(); ctx.arc(g.x, g.y - 13, 3.4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = meter > .7 ? '#f0705e' : '#ecc981'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(g.x, g.y - 13, 3.4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * meter); ctx.stroke();
  }
  let mark = g.sees ? '!' : g.indicator;
  if (!mark || (mark === '?' && age > 6 && g.state !== 'suspicious' && g.state !== 'investigate')) return;
  if (mark === '◆' && age > 3) return;
  const pop = Math.max(1, 1.7 - age * 3.2);
  const color = mark === '!' ? '#f0705e' : mark === '?' ? '#ecc981' : mark === '…' ? '#efa58e' : mark === '◆' ? '#c1aed5' : '#c1aed5';
  ctx.save();
  ctx.translate(g.x, g.y - (meter > .04 && !g.sees ? 21 : 15));
  ctx.scale(pop, pop);
  ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(8,8,10,.85)'; ctx.strokeText(mark, 0, 0);
  ctx.fillStyle = color; ctx.fillText(mark, 0, 0);
  ctx.restore();
}

function drawBlood(ctx, sim) {
  for (const stain of sim.blood) {
    const grow = stain.pool ? Math.min(1, stain.age / .5) : 1;
    const r = Math.max(.5, stain.r * (.35 + .65 * grow));
    ctx.fillStyle = stain.pool ? 'rgba(94,22,19,.52)' : 'rgba(122,32,26,.55)';
    ctx.beginPath(); ctx.arc(stain.x, stain.y, r, 0, Math.PI * 2); ctx.fill();
    if (stain.pool) {
      ctx.fillStyle = 'rgba(60,14,13,.45)';
      ctx.beginPath(); ctx.arc(stain.x + .8, stain.y + .6, r * .55, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawCombat(ctx, sim) {
  for (const tracer of sim.tracers) {
    const k = Math.min(1, tracer.age / tracer.life);
    const alpha = 1 - k;
    ctx.strokeStyle = `rgba(255,226,160,${alpha * .85})`;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(tracer.x0, tracer.y0); ctx.lineTo(tracer.x1, tracer.y1); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,238,190,${alpha * .9})`;
    ctx.beginPath(); ctx.arc(tracer.x0, tracer.y0, 2.8 * alpha, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(240,112,94,${alpha * .5})`;
    ctx.beginPath(); ctx.arc(tracer.x1, tracer.y1, 1.8 * alpha, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }
  for (const slash of sim.slashes) {
    const k = Math.min(1, slash.age / slash.life);
    ctx.strokeStyle = `rgba(240,233,221,${(1 - k) * .9})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.arc(slash.x, slash.y, 8 + k * 7, slash.angle - .95, slash.angle + .95); ctx.stroke();
    ctx.strokeStyle = `rgba(240,112,94,${(1 - k) * .55})`;
    ctx.lineWidth = .7;
    ctx.beginPath(); ctx.arc(slash.x, slash.y, 10 + k * 7, slash.angle - .7, slash.angle + .7); ctx.stroke();
  }
}

function drawDoors(ctx, sim) {
  for (const door of sim.doors.values()) {
    const x = door.tx * TILE, y = door.ty * TILE;
    const vertical = kindAt(door.tx, door.ty - 1).walk === 'none' && kindAt(door.tx, door.ty + 1).walk === 'none';
    const slide = door.open * 6.5;
    ctx.fillStyle = door.locked ? '#5b3f34' : '#4a535c';
    if (vertical) { ctx.fillRect(x + 5.5, y - slide, 5, 8); ctx.fillRect(x + 5.5, y + 8 + slide, 5, 8); }
    else { ctx.fillRect(x - slide, y + 5.5, 8, 5); ctx.fillRect(x + 8 + slide, y + 5.5, 8, 5); }
    ctx.fillStyle = door.locked ? (sim.player.keycard ? '#adbf9c' : '#f0705e') : 'rgba(165,191,220,.55)';
    if (vertical) ctx.fillRect(x + 7.4, y + 7.4, 1.2, 1.2); else ctx.fillRect(x + 7.4, y + 7.4, 1.2, 1.2);
  }
}

function drawProps(ctx, sim, time) {
  // Lockers that were just opened, the terminal, the camera panel, the keycard.
  for (const locker of sim.lockers.values()) {
    if (!locker.openedAt || time - locker.openedAt > 1.5) continue;
    ctx.fillStyle = 'rgba(10,12,14,.9)'; ctx.fillRect(locker.x * TILE + 2, locker.y * TILE + 2, TILE - 4, TILE - 4);
  }
  const blink = Math.floor(time * 2) % 2;
  ctx.fillStyle = sim.player.data ? (blink ? '#f0705e' : '#6a2e28') : blink ? '#5fd0a2' : '#3a8c6d';
  ctx.fillRect(31 * TILE + 3, 4 * TILE + 3, 2 * TILE - 6, 5);
  ctx.fillStyle = sim.net.camerasOff ? '#f0705e' : '#5fd0a2';
  ctx.fillRect(25 * TILE + 4, 17 * TILE + 4, 2, 2); ctx.fillRect(25 * TILE + 9, 17 * TILE + 4, 2, 2);
  if (sim.keycardOnDesk) {
    ctx.fillStyle = '#ecc981'; ctx.fillRect(58 * TILE + 5, 14 * TILE + 5, 6, 4);
    ctx.fillStyle = '#12110f'; ctx.fillRect(58 * TILE + 6, 14 * TILE + 6, 2, 1);
  }
  for (const camera of sim.cameras) {
    ctx.fillStyle = '#2b3137'; ctx.fillRect(camera.x - 2.5, camera.y - 2.5, 5, 5);
    ctx.save(); ctx.translate(camera.x, camera.y); ctx.rotate(camera.angle);
    ctx.fillStyle = '#56606a'; ctx.fillRect(0, -1.5, 5, 3);
    ctx.fillStyle = !camera.on ? '#3a3a3a' : camera.track > 0 ? '#f0705e' : (Math.floor(time * 1.5 + camera.index) % 2 ? '#f0705e' : '#5a2a26');
    ctx.fillRect(4, -.6, 1.2, 1.2);
    ctx.restore();
  }
}

function drawHelicopter(ctx, sim, time) {
  if (!sim.player.data) return;
  const [x0, y0, x1, y1] = EXTRACTION.rect;
  const cx = (x0 + x1 + 1) / 2 * TILE, cy = (y0 + y1 + 1) / 2 * TILE;
  const arrive = Math.min(1, (sim.t - (sim.mission.breachAt || sim.t)) / 6);
  const x = cx + (1 - arrive) * 220, y = cy - (1 - arrive) * 120;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.ellipse(6 + (1 - arrive) * 10, 10 + (1 - arrive) * 14, 16, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#2f3a33'; ctx.beginPath(); ctx.ellipse(0, 0, 12, 6.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-26, -1.5, 18, 3); ctx.fillRect(-28, -5, 3, 10);
  ctx.fillStyle = '#5f8fa3'; ctx.beginPath(); ctx.ellipse(6, 0, 4.5, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(200,210,215,.4)'; ctx.lineWidth = 1.2;
  const spin = time * 22;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) { const a = spin + i * Math.PI / 2; ctx.moveTo(Math.cos(a) * -22, Math.sin(a) * -22); ctx.lineTo(Math.cos(a) * 22, Math.sin(a) * 22); }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = `rgba(236,201,129,${.08 + .06 * Math.sin(time * 4)})`;
  ctx.beginPath(); ctx.arc(cx, cy, 40, 0, Math.PI * 2); ctx.fill();
}

/* ── main draw ─────────────────────────────────────────────────────────── */

export function camera(sim, view, dt) {
  const p = sim.player;
  const lookX = Math.cos(p.facing) * (p.moving ? 26 : 10), lookY = Math.sin(p.facing) * (p.moving ? 18 : 8);
  const targetX = Math.max(0, Math.min(WORLD_W - VIEW_W, p.x + lookX - VIEW_W / 2));
  const targetY = Math.max(0, Math.min(WORLD_H - VIEW_H, p.y + lookY - VIEW_H / 2));
  const k = view.snap ? 1 : 1 - Math.pow(.0025, dt);
  view.x += (targetX - view.x) * k; view.y += (targetY - view.y) * k;
  view.snap = false;
}

export function drawWorld(ctx, sim, view, opts = {}) {
  const time = sim.t, cam = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#07080a'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const sx = Math.round(Math.max(0, Math.min(WORLD_W - VIEW_W, cam.x + (opts.shake?.x || 0))) * SCALE) / SCALE;
  const sy = Math.round(Math.max(0, Math.min(WORLD_H - VIEW_H, cam.y + (opts.shake?.y || 0))) * SCALE) / SCALE;
  ctx.setTransform(SCALE, 0, 0, SCALE, -sx * SCALE, -sy * SCALE);
  ctx.drawImage(staticLayer(), 0, 0, WORLD_W * SCALE, WORLD_H * SCALE, 0, 0, WORLD_W, WORLD_H);
  drawDoors(ctx, sim);
  drawProps(ctx, sim, time);
  for (const g of sim.guards) if (g.down && !g.hidden && !g.carried) drawGuard(ctx, g, time, false);

  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(darknessLayer(), 0, 0, COLS, ROWS, 0, 0, WORLD_W, WORLD_H);
  ctx.imageSmoothingEnabled = false;
  // Blood stays legible in unlit rooms; it is the loudest visual signal in the game.
  drawBlood(ctx, sim);

  // Vision cones read as light beams cutting through the dark.
  const onScreen = (x, y, pad = 140) => x > cam.x - pad && x < cam.x + VIEW_W + pad && y > cam.y - pad && y < cam.y + VIEW_H + pad;
  ctx.globalCompositeOperation = 'screen';
  for (const g of sim.guards) {
    if (g.down || g.grabbed || !onScreen(g.x, g.y)) continue;
    const range = sim.rules.range * TILE * (g.groggy > 0 ? .7 : 1);
    const color = STATE_COLORS[g.sees ? 'alert' : g.state] || STATE_COLORS.patrol;
    fillCone(ctx, conePolygon(sim, g.x, g.y, g.facing, sim.rules.fov / 2, range), g.x, g.y, range, color, g.sees ? .42 : .3);
    ctx.fillStyle = hexAlpha(color, .05); ctx.beginPath(); ctx.arc(g.x, g.y, sim.rules.peripheral * TILE, 0, Math.PI * 2); ctx.fill();
  }
  for (const camera of sim.cameras) {
    if (!camera.on || !onScreen(camera.x, camera.y)) continue;
    const color = camera.track > 0 || camera.meter > .5 ? '#f0705e' : '#a5bfdc';
    fillCone(ctx, conePolygon(sim, camera.x, camera.y, camera.angle, .52, camera.range, 18), camera.x, camera.y, camera.range, color, .22 + camera.meter * .2);
  }
  ctx.globalCompositeOperation = 'source-over';

  for (const ring of sim.rings) {
    if (!onScreen(ring.x, ring.y)) continue;
    const k = ring.age / ring.life;
    ctx.strokeStyle = ring.kind === 'pebble' || ring.kind === 'knock' ? `rgba(240,233,221,${.55 * (1 - k)})` : `rgba(236,201,129,${.45 * (1 - k)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(ring.x, ring.y, Math.max(1, ring.r * (.3 + .7 * k)), 0, Math.PI * 2); ctx.stroke();
  }
  for (const pebble of sim.pebbles) {
    if (pebble.done) continue;
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(pebble.x - .8, pebble.y - .8, 1.6, 1.6);
    ctx.fillStyle = '#d8d2c4'; ctx.fillRect(pebble.x - .9, pebble.y - .9 - (pebble.z || 0), 1.8, 1.8);
  }
  drawHelicopter(ctx, sim, time);
  for (const g of sim.guards) if (!g.down && onScreen(g.x, g.y, 20)) drawGuard(ctx, g, time, opts.selected === g.id);
  for (const g of sim.guards) if (g.carried) drawGuard(ctx, g, time, false);
  drawPlayer(ctx, sim.player, time);
  drawCombat(ctx, sim);
  if (sim.player.locker) {
    ctx.strokeStyle = `rgba(236,201,129,${.5 + .3 * Math.sin(time * 4)})`; ctx.lineWidth = .8;
    ctx.strokeRect(toTile(sim.player.x) * TILE + 1.5, toTile(sim.player.y) * TILE + 1.5, TILE - 3, TILE - 3);
  }
  if (sim.player.action) {
    const a = sim.player.action, k = Math.min(1, a.t / a.need);
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sim.player.x, sim.player.y - 12, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ecc981'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(sim.player.x, sim.player.y - 12, 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
  }
  if (opts.intel) drawIntel(ctx, sim, opts);
  for (const g of sim.guards) if (!g.down && onScreen(g.x, g.y, 20)) drawIndicator(ctx, g, time);
  if (opts.target) { const g = sim.guards.find(item => item.id === opts.target); if (g) drawTargetMark(ctx, g, time); }
  if (opts.aim && opts.aiming) drawAim(ctx, sim, opts.aim, opts.aimHold);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawEdges(ctx, sim, cam);
  drawScanner(ctx, sim, opts);
}

/** Corner brackets on the guard a takedown or knife can reach right now. */
function drawTargetMark(ctx, g, time) {
  const r = 10 + Math.sin(time * 8) * .8, k = 3.2;
  ctx.strokeStyle = 'rgba(236,201,129,.9)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = g.x + sx * r, y = g.y + sy * r;
    ctx.moveTo(x, y - sy * k); ctx.lineTo(x, y); ctx.lineTo(x - sx * k, y);
  }
  ctx.stroke();
}

/** The cursor reticle; with the pistol drawn, a laser to the first wall along the aim. */
function drawAim(ctx, sim, aim, armed) {
  const p = sim.player, angle = Math.atan2(aim.y - p.y, aim.x - p.x);
  if (armed) {
    const reach = rayLength(sim, p.x, p.y, angle, 9.5 * TILE);
    ctx.strokeStyle = 'rgba(240,112,94,.55)'; ctx.lineWidth = .7; ctx.setLineDash([3, 2]);
    ctx.beginPath(); ctx.moveTo(p.x + Math.cos(angle) * 9, p.y + Math.sin(angle) * 9); ctx.lineTo(p.x + Math.cos(angle) * reach, p.y + Math.sin(angle) * reach); ctx.stroke();
    ctx.setLineDash([]);
  }
  const r = armed ? 3.2 : 2.6;
  ctx.strokeStyle = armed ? 'rgba(240,112,94,.95)' : 'rgba(240,233,221,.6)'; ctx.lineWidth = .8;
  ctx.beginPath(); ctx.arc(aim.x, aim.y, r, 0, Math.PI * 2);
  ctx.moveTo(aim.x - r - 2.5, aim.y); ctx.lineTo(aim.x - r + .8, aim.y); ctx.moveTo(aim.x + r - .8, aim.y); ctx.lineTo(aim.x + r + 2.5, aim.y);
  ctx.moveTo(aim.x, aim.y - r - 2.5); ctx.lineTo(aim.x, aim.y - r + .8); ctx.moveTo(aim.x, aim.y + r - .8); ctx.lineTo(aim.x, aim.y + r + 2.5);
  ctx.stroke();
}

/** Arrows at the screen edge for guards who are noticing the player off screen. */
function drawEdges(ctx, sim, cam) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  for (const g of sim.guards) {
    if (g.down || (!g.sees && g.meter < .15)) continue;
    const sx = (g.x - cam.x) * SCALE, sy = (g.y - cam.y) * SCALE;
    if (sx > 0 && sx < w && sy > 0 && sy < h) continue;
    const cx = Math.max(18, Math.min(w - 18, sx)), cy = Math.max(18, Math.min(h - 18, sy));
    const angle = Math.atan2(sy - h / 2, sx - w / 2);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
    ctx.fillStyle = g.sees ? '#f0705e' : '#ecc981';
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

/* ── proximity scanner ─────────────────────────────────────────────────── */

let scannerCache = null;
function scannerWalls() {
  if (scannerCache) return scannerCache;
  scannerCache = new Uint8Array(COLS * ROWS);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const k = kindAt(tx, ty);
    scannerCache[index(tx, ty)] = k.sight === 'block' && k.walk === 'none' ? 1 : k.name === 'fence' ? 2 : k.walk === 'none' ? 3 : 0;
  }
  return scannerCache;
}

function drawScanner(ctx, sim, opts) {
  const w = 176, h = 124, x0 = ctx.canvas.width - w - 14, y0 = 14;
  const p = sim.player, cell = 5.2, span = 16;
  ctx.save();
  ctx.fillStyle = 'rgba(6,10,9,.78)'; ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(173,191,156,.45)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, y0 + .5, w - 1, h - 1);
  ctx.beginPath(); ctx.rect(x0 + 1, y0 + 1, w - 2, h - 2); ctx.clip();
  const jammed = opts.jammed;
  if (jammed) {
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = `rgba(173,191,156,${Math.random() * .35})`;
      ctx.fillRect(x0 + Math.random() * w, y0 + Math.random() * h, 2, 1);
    }
    ctx.fillStyle = '#f0705e'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('JAMMED', x0 + w / 2, y0 + h / 2);
    ctx.restore();
    return;
  }
  const walls = scannerWalls();
  const ptx = p.x / TILE, pty = p.y / TILE, cx = x0 + w / 2, cy = y0 + h / 2;
  for (let ty = Math.floor(pty - span); ty <= pty + span; ty++) for (let tx = Math.floor(ptx - span * 1.4); tx <= ptx + span * 1.4; tx++) {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
    const v = walls[index(tx, ty)];
    if (!v) continue;
    ctx.fillStyle = v === 1 ? 'rgba(173,191,156,.5)' : v === 2 ? 'rgba(173,191,156,.22)' : 'rgba(173,191,156,.28)';
    ctx.fillRect(cx + (tx - ptx) * cell, cy + (ty - pty) * cell, cell + .4, cell + .4);
  }
  for (const g of sim.guards) {
    if (g.down) continue;
    const gx = cx + (g.x / TILE - ptx) * cell, gy = cy + (g.y / TILE - pty) * cell;
    if (gx < x0 - 20 || gx > x0 + w + 20 || gy < y0 - 20 || gy > y0 + h + 20) continue;
    const color = STATE_COLORS[g.sees ? 'alert' : g.state] || STATE_COLORS.patrol;
    ctx.fillStyle = hexAlpha(color, .26);
    ctx.beginPath(); ctx.moveTo(gx, gy);
    ctx.arc(gx, gy, sim.rules.range * cell * .7, g.facing - sim.rules.fov / 2, g.facing + sim.rules.fov / 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = g.sees ? '#f0705e' : '#f0e9dd';
    ctx.beginPath(); ctx.arc(gx, gy, 2.4, 0, Math.PI * 2); ctx.fill();
  }
  for (const camera of sim.cameras) {
    if (!camera.on) continue;
    const gx = cx + (camera.x / TILE - ptx) * cell, gy = cy + (camera.y / TILE - pty) * cell;
    ctx.fillStyle = '#a5bfdc'; ctx.fillRect(gx - 2, gy - 2, 4, 4);
  }
  ctx.fillStyle = '#ecc981'; ctx.beginPath(); ctx.arc(cx, cy, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(173,191,156,.6)'; ctx.font = '9px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText('PROXIMITY', x0 + 6, y0 + 5);
  ctx.restore();
}

/* ── intel overlay ─────────────────────────────────────────────────────── */

function label(ctx, text, x, y, color, bg = 'rgba(8,9,11,.82)') {
  ctx.font = '5px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width + 4;
  ctx.fillStyle = bg; ctx.fillRect(x - width / 2, y - 3.6, width, 7.2);
  ctx.fillStyle = color; ctx.fillText(text, x, y + .2);
}

function zoneRects(zoneId) {
  const zone = ZONES.find(item => item.id === zoneId);
  return zone ? (zone.rects || [zone.rect]) : [];
}

function drawIntel(ctx, sim, opts) {
  const net = sim.net, plan = net.plan, decision = net.decision;
  // Predicted whereabouts: hatched zone with the model's probability.
  if (net.prediction?.zone && (net.phase === 'alert' || net.phase === 'search')) {
    const prob = decision?.answers?.whereabouts?.probabilities?.[net.prediction.zone] ?? decision?.answers?.heading?.confidence;
    for (const [x0, y0, x1, y1] of zoneRects(net.prediction.zone)) {
      const x = x0 * TILE, y = y0 * TILE, w = (x1 - x0 + 1) * TILE, h = (y1 - y0 + 1) * TILE;
      ctx.fillStyle = 'rgba(193,174,213,.08)'; ctx.fillRect(x, y, w, h);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      ctx.strokeStyle = 'rgba(193,174,213,.22)'; ctx.lineWidth = .6; ctx.beginPath();
      for (let i = -h; i < w; i += 6) { ctx.moveTo(x + i, y + h); ctx.lineTo(x + i + h, y); }
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = 'rgba(193,174,213,.55)'; ctx.setLineDash([3, 2]); ctx.strokeRect(x + .5, y + .5, w - 1, h - 1); ctx.setLineDash([]);
    }
    const [x0, y0, x1] = zoneRects(net.prediction.zone)[0] || [0, 0, 0];
    label(ctx, `${decision?.source === 'jev' ? 'jev' : 'local'} predicts${prob != null ? ' ' + Math.round(prob * 100) + '%' : ''}${net.prediction.resolved ? ' · ' + net.prediction.resolved : ''}`, (x0 + x1 + 1) / 2 * TILE, y0 * TILE + 5, '#c1aed5');
  }
  // Last known position.
  if (net.lastSeen && net.phase !== 'calm') {
    const { x, y } = net.lastSeen, ago = Math.round(sim.t - net.lastSeen.at);
    ctx.strokeStyle = '#f0705e'; ctx.lineWidth = 1.1;
    ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
    label(ctx, `last seen ${ago}s`, x, y + 9, '#f0705e');
  }
  for (const item of net.evidence.slice(0, 5)) {
    if (sim.t - item.at > 30) continue;
    ctx.strokeStyle = 'rgba(236,201,129,.6)'; ctx.lineWidth = .7;
    ctx.beginPath(); ctx.arc(item.x, item.y, 4, 0, Math.PI * 2); ctx.stroke();
    label(ctx, `${item.kind} ${Math.round(sim.t - item.at)}s`, item.x, item.y - 8, '#ecc981');
  }
  for (const g of sim.guards) {
    const task = g.task;
    const selected = opts.selected === g.id;
    if (g.path?.length && (selected || ['alert', 'search', 'lockdown', 'investigate'].includes(g.state))) {
      ctx.strokeStyle = hexAlpha(STATE_COLORS[g.state] || '#e9dcb4', selected ? .7 : .35); ctx.lineWidth = .7; ctx.setLineDash([1.5, 2]);
      ctx.beginPath(); ctx.moveTo(g.x, g.y); for (const point of g.path) ctx.lineTo(point.x, point.y); ctx.stroke(); ctx.setLineDash([]);
    }
    if (task && task.x != null && task.role !== 'return') {
      const color = task.role === 'block' || task.role === 'intercept' || task.role === 'guard' ? '#c1aed5' : task.role === 'probe' ? '#efa58e' : task.role === 'pursue' ? '#f0705e' : '#ecc981';
      ctx.strokeStyle = hexAlpha(color, .8); ctx.lineWidth = .9;
      if (task.role === 'block' || task.role === 'guard' || task.role === 'intercept') {
        ctx.strokeRect(task.x - 3.5, task.y - 3.5, 7, 7);
        if (Number.isFinite(task.face)) { ctx.beginPath(); ctx.moveTo(task.x, task.y); ctx.lineTo(task.x + Math.cos(task.face) * 9, task.y + Math.sin(task.face) * 9); ctx.stroke(); }
      } else { ctx.beginPath(); ctx.arc(task.x, task.y, 3.5, 0, Math.PI * 2); ctx.stroke(); }
    }
    if (g.down && !net.missing.has(g.id) && !net.found.has(g.id)) continue;
    const role = g.dead ? 'dead' : g.down ? 'down' : task ? (task.label || task.role) : g.lastAction;
    label(ctx, `${g.name} · ${String(role).slice(0, 30)}`, g.x, g.y + 12, STATE_COLORS[g.state] || '#e9dcb4', selected ? 'rgba(40,36,28,.92)' : 'rgba(8,9,11,.78)');
  }
  if (plan?.roles) for (const role of plan.roles) if (role.exit && (role.role === 'block' || role.role === 'intercept')) {
    ctx.fillStyle = 'rgba(193,174,213,.25)'; ctx.beginPath(); ctx.arc(role.x, role.y, 6, 0, Math.PI * 2); ctx.fill();
  }
}

/** A blueprint of the facility for the briefing. */
export function drawSchematic(canvas, dossierHeat = {}) {
  const ctx = canvas.getContext('2d'), s = canvas.width / WORLD_W;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#0d1418'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  for (const [zone, weight] of Object.entries(dossierHeat)) {
    for (const [x0, y0, x1, y1] of zoneRects(zone)) {
      ctx.fillStyle = `rgba(240,112,94,${Math.min(.35, weight * .1)})`;
      ctx.fillRect(x0 * TILE, y0 * TILE, (x1 - x0 + 1) * TILE, (y1 - y0 + 1) * TILE);
    }
  }
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const ch = MAP[ty][tx], k = kindAt(tx, ty);
    if (ch === '#') ctx.fillStyle = 'rgba(165,191,220,.55)';
    else if (ch === 'F' || ch === 'f') ctx.fillStyle = 'rgba(165,191,220,.25)';
    else if (ch === 'T') ctx.fillStyle = 'rgba(173,191,156,.22)';
    else if (ch === 'v' || ch === '~') ctx.fillStyle = 'rgba(236,201,129,.45)';
    else if (ch === 'X') ctx.fillStyle = 'rgba(236,201,129,.3)';
    else if (ch === 'O') ctx.fillStyle = '#f0705e';
    else if (k.walk === 'none') ctx.fillStyle = 'rgba(165,191,220,.18)';
    else if (ch === 'D' || ch === 'K') ctx.fillStyle = ch === 'K' ? 'rgba(240,112,94,.6)' : 'rgba(165,191,220,.35)';
    else continue;
    ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
  }
  ctx.fillStyle = 'rgba(240,233,221,.55)'; ctx.font = '22px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const [text, x, y] of [['LAB', 39, 6.5], ['STORAGE', 10, 18.5], ['CORRIDORS', 31.5, 18.6], ['BARRACKS', 50, 19.8], ['HELIPAD', 55, 10], ['GATE', 31.5, 33], ['DOCK', 8.5, 6.5]]) ctx.fillText(text, x * TILE, y * TILE);
  ctx.fillStyle = '#ecc981'; ctx.beginPath(); ctx.arc(20.5 * TILE, 41.5 * TILE, 10, 0, Math.PI * 2); ctx.fill();
}

export { wrapAngle };
