// Shadow Protocol's light. The facility is painted fully lit; this module builds
// the light that multiplies it each frame. Lamps are baked once into a coloured
// light map with ray-cast shadows; guard flashlights, camera beams, muzzle
// flashes, screens and the alarm are added live on top. Drawing only: what a
// guard can see still comes from the light grid in shadow-nav.js, and the lamps
// here use the same positions, radii and falloff so the two agree.
import { TILE, COLS, ROWS, WORLD_W, WORLD_H, LAMPS, ZONES, kindAt, tileAt, toTile } from './shadow-level.js';
import { LIGHT, index } from './shadow-nav.js';

/** Light-buffer pixels per world unit. Low on purpose: the browser's smoothing softens every edge. */
export const LIGHT_RES = 2;
// Moonlight outside, a dim night level indoors, and roofs darker still.
const AMBIENT = { indoor: [50, 56, 76], outdoor: [58, 68, 98], roof: [40, 44, 58] };
// These lamps flicker, so they are drawn live rather than baked.
const FLICKER = new Set([12, 15, 21]);

const zoneOf = (x, y) => ZONES.find(zone => (zone.rects || [zone.rect]).some(r => x >= r[0] && x <= r[2] + .99 && y >= r[1] && y <= r[3] + .99));

/** A lamp's colour from where it hangs: sodium outside, fluorescent in the corridors, cold in the lab. */
export function lampColor(lamp) {
  const zone = zoneOf(lamp.x, lamp.y);
  if (!zone) return [255, 178, 98];
  if (zone.sector === 'lab') return [176, 226, 255];
  if (zone.id === 'security') return [150, 196, 255];
  if (zone.sector === 'corridors') return [214, 228, 255];
  if (zone.sector === 'warehouse') return [255, 212, 156];
  if (zone.sector === 'barracks') return [255, 198, 138];
  return [255, 176, 96];
}
export const isOutdoorLamp = lamp => ['yard', 'north', 'exterior', 'perimeter'].includes(zoneOf(lamp.x, lamp.y)?.sector);

const polygons = new Map();
/** Where a lamp's light reaches: rays stop at walls and shut doors, and bite a little into the wall they hit. */
function lampPolygon(lamp) {
  if (polygons.has(lamp)) return polygons.get(lamp);
  const cx = lamp.x * TILE, cy = lamp.y * TILE, range = lamp.r * TILE, rays = 180, points = [];
  for (let i = 0; i < rays; i++) {
    const a = i / rays * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
    let d = 2;
    for (; d < range; d += 1.5) {
      const sight = kindAt(toTile(cx + dx * d), toTile(cy + dy * d)).sight;
      if (sight === 'block' || sight === 'door') break;
    }
    d = Math.min(range, d + 3);
    points.push([cx + dx * d, cy + dy * d]);
  }
  polygons.set(lamp, points);
  return points;
}

/** Fills a light polygon with a radial falloff matching the gameplay grid's (1 - d/r)^1.35. */
export function paintLight(ctx, points, x, y, range, [r, g, b], strength) {
  if (strength <= .005) return;
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, range);
  for (const stop of [0, .2, .4, .6, .8, 1]) gradient.addColorStop(stop, `rgba(${r},${g},${b},${Math.min(1, strength * Math.pow(1 - stop, 1.35)).toFixed(3)})`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
  ctx.closePath();
  ctx.fill();
}
function paintLamp(ctx, lamp, gain = 1) {
  paintLight(ctx, lampPolygon(lamp), lamp.x * TILE, lamp.y * TILE, lamp.r * TILE, lampColor(lamp), lamp.s * 1.2 * gain);
}

let baked = null;
/** Ambient plus every steady lamp, one pixel per world unit. Built once. */
export function lightMap() {
  if (baked) return baked;
  const ambient = document.createElement('canvas');
  ambient.width = COLS; ambient.height = ROWS;
  const actx = ambient.getContext('2d'), image = actx.createImageData(COLS, ROWS);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const kind = kindAt(tx, ty), ch = tileAt(tx, ty);
    const outdoor = kind.outdoor || ty >= 31 || ch === 'T' || ch === 'F' || ch === 'f' || ch === '~';
    const roof = ch === '#' && !outdoor;
    const [r, g, b] = roof ? AMBIENT.roof : outdoor ? AMBIENT.outdoor : AMBIENT.indoor;
    const i = (ty * COLS + tx) * 4;
    image.data[i] = r; image.data[i + 1] = g; image.data[i + 2] = b; image.data[i + 3] = 255;
  }
  actx.putImageData(image, 0, 0);
  baked = document.createElement('canvas');
  baked.width = WORLD_W; baked.height = WORLD_H;
  const ctx = baked.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(ambient, 0, 0, WORLD_W, WORLD_H);
  ctx.globalCompositeOperation = 'lighter';
  LAMPS.forEach((lamp, i) => { if (!FLICKER.has(i)) paintLamp(ctx, lamp); });
  return baked;
}

/** A lamp's brightness this instant: steady ones are 1; a bad tube stutters now and then. */
export function lampLevel(i, time, reduceMotion = false) {
  if (!FLICKER.has(i) || reduceMotion) return 1;
  const slow = Math.sin(time * 1.3 + i * 7.1), fast = Math.sin(time * 37 + i * 3.3);
  return slow > .82 ? (fast > 0 ? .35 : .9) : .96 + .04 * Math.sin(time * 9 + i);
}

let buffer = null;
/**
 * Builds this frame's light for the view and multiplies the world by it. `sources` are the
 * live lights: { points, x, y, range, color, strength } polygons, and { x, y, radius, color, strength } glows.
 */
export function applyLight(ctx, view, sources, { time = 0, alarm = 0, reduceMotion = false } = {}) {
  const { sx, sy, vw, vh } = view;
  const lw = Math.max(1, Math.ceil(vw * LIGHT_RES)), lh = Math.max(1, Math.ceil(vh * LIGHT_RES));
  if (!buffer) buffer = document.createElement('canvas');
  if (buffer.width !== lw || buffer.height !== lh) { buffer.width = lw; buffer.height = lh; }
  const l = buffer.getContext('2d');
  l.setTransform(1, 0, 0, 1, 0, 0);
  l.globalCompositeOperation = 'source-over';
  l.imageSmoothingEnabled = true;
  l.drawImage(lightMap(), sx, sy, vw, vh, 0, 0, lw, lh);
  l.setTransform(LIGHT_RES, 0, 0, LIGHT_RES, -sx * LIGHT_RES, -sy * LIGHT_RES);
  l.globalCompositeOperation = 'lighter';
  for (const i of FLICKER) {
    const lamp = LAMPS[i], reach = lamp.r * TILE;
    if (lamp.x * TILE + reach < sx || lamp.x * TILE - reach > sx + vw || lamp.y * TILE + reach < sy || lamp.y * TILE - reach > sy + vh) continue;
    paintLamp(l, lamp, lampLevel(i, time, reduceMotion));
  }
  for (const source of sources) {
    if (source.points) paintLight(l, source.points, source.x, source.y, source.range, source.color, source.strength);
    else {
      const [r, g, b] = source.color, gradient = l.createRadialGradient(source.x, source.y, 0, source.x, source.y, source.radius);
      gradient.addColorStop(0, `rgba(${r},${g},${b},${Math.min(1, source.strength).toFixed(3)})`);
      gradient.addColorStop(.45, `rgba(${r},${g},${b},${Math.min(1, source.strength * .4).toFixed(3)})`);
      gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
      l.fillStyle = gradient;
      l.fillRect(source.x - source.radius, source.y - source.radius, source.radius * 2, source.radius * 2);
    }
  }
  // The alarm washes everything in a slow red pulse.
  if (alarm > 0) {
    l.setTransform(1, 0, 0, 1, 0, 0);
    l.fillStyle = `rgba(255,46,30,${(alarm * (reduceMotion ? .1 : .07 + .07 * Math.sin(time * 4.5))).toFixed(3)})`;
    l.fillRect(0, 0, lw, lh);
  }
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(buffer, 0, 0, lw, lh, sx, sy, vw, vh);
  ctx.restore();
}

/** 0..1, how lit a point is on the gameplay grid; used to keep bodies in shadow just readable. */
export const lightLevel = (x, y) => {
  const tx = toTile(x), ty = toTile(y);
  return tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS ? LIGHT[index(tx, ty)] : 0;
};
