// Shadow Protocol's standing world in the ¾ view: walls with real facades,
// crates and containers, furniture, lockers, racks, fences, lamp posts, trees,
// tall grass and doors. Each one is drawn in the projected plane, where a ground
// point (x, y) at height z sits at (x, y·K − z·V) (see shadow-view.js), with a
// top and a south face. Static tiles are painted once into small cached
// sprites; anything that moves (doors, grass, canopies) is drawn live. The
// renderer sorts these with the actors by how far south they stand.
import { TILE, COLS, ROWS, MAP, ZONE_BY_ID, LAMPS, PROPS, kindAt, tileAt, zoneOfTile } from './shadow-level.js';
import { K, V, HEIGHT, SPRITE_PX } from './shadow-view.js';
import { PROP_SHEET, PROP_SPRITES } from '../shared/shadow-props.js';
import { isOutdoorLamp } from './shadow-light.js';

const FK = TILE * K;
const PAD = 3, HEAD = 34 * V + 3;
export const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };

function zoneNear(tx, ty) {
  const own = zoneOfTile(tx, ty);
  if (own) return own;
  const around = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [dx, dy] of around) if (kindAt(tx + dx, ty + dy).walk !== 'none' && zoneOfTile(tx + dx, ty + dy)) return zoneOfTile(tx + dx, ty + dy);
  for (const [dx, dy] of around) if (zoneOfTile(tx + dx, ty + dy)) return zoneOfTile(tx + dx, ty + dy);
  return null;
}
const sectorNear = (tx, ty) => ZONE_BY_ID[zoneNear(tx, ty)]?.sector || null;
const isWall = (tx, ty) => tileAt(tx, ty) === '#';

/**
 * A box standing on part of a tile. x0..x1 across, d0..d1 the ground depth (0 = the tile's north edge,
 * 16 = its south edge), h its height. Draws the south face and the top; returns both rects for detailing.
 */
function block(ctx, x0, x1, d0, d1, h, top, face) {
  const faceRect = { x: x0, y: d1 * K - h * V, w: x1 - x0, h: h * V };
  const topRect = { x: x0, y: d0 * K - h * V, w: x1 - x0, h: (d1 - d0) * K };
  if (face) { ctx.fillStyle = face; ctx.fillRect(faceRect.x, faceRect.y, faceRect.w, faceRect.h); }
  if (top) { ctx.fillStyle = top; ctx.fillRect(topRect.x, topRect.y, topRect.w, topRect.h); }
  return { top: topRect, face: faceRect };
}
function grime(ctx, r, tx, ty, strength = .22) {
  const gradient = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
  gradient.addColorStop(0, 'rgba(0,0,0,0)'); gradient.addColorStop(1, `rgba(12,10,8,${strength})`);
  ctx.fillStyle = gradient; ctx.fillRect(r.x, r.y, r.w, r.h);
  for (let i = 0; i < 3; i++) {
    if (hash(tx * 7 + i, ty * 3) < .55) continue;
    ctx.fillStyle = `rgba(16,14,12,${(.08 + hash(tx, ty + i) * .12).toFixed(3)})`;
    const sx = r.x + hash(tx + i, ty * 5) * (r.w - 2);
    ctx.fillRect(sx, r.y + r.h * .3, .5 + hash(i, tx) * 1.2, r.h * .7);
  }
}
function speckle(ctx, r, tx, ty, count, light, dark, size = .5) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = i % 2 ? light : dark;
    ctx.fillRect(r.x + hash(tx * 3 + i, ty * 5) * (r.w - size), r.y + hash(tx * 7, ty * 3 + i) * (r.h - size), size, size);
  }
}

/* ── walls ─────────────────────────────────────────────────────────────── */

const FACADES = {
  lab: { cap: '#4a5156', face: '#b7c0c4', panel: '#a3acb1', trim: '#5fb3c9', base: '#59636a' },
  corridors: { cap: '#43474e', face: '#8b9198', panel: '#7d838a', trim: '#c9a640', base: '#4a4f56' },
  warehouse: { cap: '#46433d', face: '#7f7a6f', panel: '#6f6a60', trim: 'hazard', base: '#4a463f' },
  barracks: { cap: '#47423b', face: '#8a6f5a', panel: '#7a604d', trim: '#5a4535', base: '#4b3d33', brick: true },
  north: { cap: '#3f4342', face: '#7a7f7d', panel: '#6c716f', trim: null, base: '#464b49' },
  yard: { cap: '#3f4342', face: '#7a7f7d', panel: '#6c716f', trim: null, base: '#464b49' },
  perimeter: { cap: '#3b3f3e', face: '#6e7371', panel: '#626765', trim: null, base: '#3f4443', wire: true },
};

function paintWall(ctx, tx, ty) {
  const sector = tx === 0 || ty === 0 || tx === COLS - 1 ? 'perimeter' : sectorNear(tx, ty) || 'corridors';
  const f = FACADES[sector] || FACADES.corridors, H = HEIGHT.wall, n = hash(tx, ty);
  const faced = !isWall(tx, ty + 1) && ty < ROWS - 1;
  // A hair wider than the tile, so neighbours overlap instead of leaving a seam at fractional zoom.
  const r = block(ctx, -.3, TILE + .3, 0, TILE + (isWall(tx, ty + 1) ? .4 : 0), H, f.cap, faced ? f.face : null);
  // The cap: a thick concrete edge catching the light wherever it meets open space.
  ctx.fillStyle = 'rgba(190,198,206,.42)';
  if (!isWall(tx, ty - 1)) ctx.fillRect(0, r.top.y, TILE, 1.1);
  if (!isWall(tx - 1, ty)) ctx.fillRect(0, r.top.y, 1.1, r.top.h);
  if (!isWall(tx + 1, ty)) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(TILE - 1, r.top.y, 1, r.top.h); }
  if (faced) { ctx.fillStyle = 'rgba(214,220,228,.55)'; ctx.fillRect(0, r.top.y + r.top.h - .9, TILE, .9); }
  speckle(ctx, r.top, tx, ty, 6, 'rgba(255,255,255,.05)', 'rgba(0,0,0,.1)');
  if (f.wire && !isWall(tx, ty + 1)) {
    // Coiled razor wire along the perimeter wall's cap.
    ctx.strokeStyle = 'rgba(170,176,180,.6)'; ctx.lineWidth = .4;
    for (let i = 0; i < TILE; i += 3) { ctx.beginPath(); ctx.arc(i + 1.5, r.top.y + 2.4, 1.6, 0, Math.PI * 2); ctx.stroke(); }
  }
  if (!faced) return;
  const face = r.face;
  // Panels, a trim line, a baseboard, grime running down from the top.
  if (f.brick) {
    for (let row = 0; row < face.h - 1; row += 1.6) {
      ctx.fillStyle = 'rgba(40,24,16,.28)'; ctx.fillRect(0, face.y + row, TILE, .3);
      const offset = (Math.round(row / 1.6) % 2) * 2;
      for (let i = offset; i < TILE; i += 4) ctx.fillRect(i, face.y + row, .3, 1.6);
    }
  } else {
    ctx.fillStyle = f.panel;
    ctx.fillRect(.6, face.y + 1.2, TILE / 2 - 1, face.h - 3.6); ctx.fillRect(TILE / 2 + .4, face.y + 1.2, TILE / 2 - 1, face.h - 3.6);
    ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(TILE / 2 - .3, face.y + 1, .5, face.h - 3);
  }
  if (f.trim === 'hazard') {
    for (let i = 0; i < TILE; i += 2.5) { ctx.fillStyle = Math.floor((tx * TILE + i) / 2.5) % 2 ? '#d1ab42' : '#23201b'; ctx.fillRect(i, face.y + face.h - 3.4, 2.5, 1.6); }
  } else if (f.trim) { ctx.fillStyle = f.trim; ctx.fillRect(0, face.y + face.h * .42, TILE, .8); }
  ctx.fillStyle = f.base; ctx.fillRect(0, face.y + face.h - 1.6, TILE, 1.6);
  ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, face.y, TILE, .5);
  // Some walls carry a pipe, a vent, a sign or a window.
  if (n > .82) {
    ctx.fillStyle = '#5a6168'; ctx.fillRect(3 + n * 6, face.y, 1.4, face.h - 1.6);
    ctx.fillStyle = '#7d858c'; ctx.fillRect(3 + n * 6, face.y, .5, face.h - 1.6);
    ctx.fillStyle = '#4a5056'; ctx.fillRect(2.5 + n * 6, face.y + face.h * .55, 2.4, .9);
  } else if (n > .7) {
    ctx.fillStyle = '#2b3035'; ctx.fillRect(4, face.y + 2.4, 8, 3.6);
    ctx.fillStyle = '#4b5258'; for (let i = 0; i < 4; i++) ctx.fillRect(4.6, face.y + 2.9 + i * .8, 6.8, .35);
  } else if (n > .62 && sector !== 'perimeter') {
    const sign = ['#c9a640', '#f0705e', '#5fb3c9', '#d9d5c9'][Math.floor(n * 40) % 4];
    ctx.fillStyle = sign; ctx.fillRect(5, face.y + 2.2, 6, 3.4);
    ctx.fillStyle = 'rgba(20,20,22,.55)'; ctx.fillRect(6, face.y + 3, 4, .5); ctx.fillRect(6, face.y + 4.1, 2.6, .5);
  } else if (sector === 'perimeter' && n > .45) {
    ctx.fillStyle = '#1e2428'; ctx.fillRect(4.5, face.y + 2.4, 7, 4.2);
    ctx.fillStyle = '#4d565d'; ctx.fillRect(4.5, face.y + 2.4, 7, .5); ctx.fillRect(7.8, face.y + 2.4, .4, 4.2);
  }
  grime(ctx, face, tx, ty, sector === 'lab' ? .14 : .3);
}

/* ── objects ───────────────────────────────────────────────────────────── */

function paintCrate(ctx, tx, ty) {
  const n = hash(tx, ty), metal = n > .62 || ty > 24, stacked = !metal && n < .18;
  const inset = .4 + hash(ty, tx) * 1.4, h = metal ? HEIGHT.crate + 2 : stacked ? HEIGHT.crate * 1.8 : HEIGHT.crate;
  if (metal) {
    const rust = ty > 24;
    const r = block(ctx, inset, TILE - inset, inset, TILE - inset, h, rust ? '#6d8172' : '#6c9283', rust ? '#4e6457' : '#4f7466');
    for (let i = r.face.x + 1.4; i < r.face.x + r.face.w - 1; i += 2.2) { ctx.fillStyle = 'rgba(0,0,0,.2)'; ctx.fillRect(i, r.face.y + .6, .7, r.face.h - 1.2); ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(i + .7, r.face.y + .6, .3, r.face.h - 1.2); }
    ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.fillRect(r.top.x, r.top.y, r.top.w, .7);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; for (let i = r.top.x + 2; i < r.top.x + r.top.w - 1; i += 3.2) ctx.fillRect(i, r.top.y + 1, .5, r.top.h - 2);
    if (rust || n > .8) { ctx.fillStyle = 'rgba(150,84,40,.45)'; ctx.fillRect(r.face.x + 2 + n * 8, r.face.y + 1, 2.6, r.face.h * .7); ctx.fillRect(r.top.x + n * 9, r.top.y + 2, 3, 2); }
    grime(ctx, r.face, tx, ty, .25);
    return;
  }
  const r = block(ctx, inset, TILE - inset, inset, TILE - inset, h, '#b88d55', '#8e6b3e');
  ctx.fillStyle = '#9e7848';
  for (let i = r.top.y + 2.6; i < r.top.y + r.top.h - .5; i += 2.6) ctx.fillRect(r.top.x + .8, i, r.top.w - 1.6, .4);
  ctx.strokeStyle = '#7a5a32'; ctx.lineWidth = .9; ctx.strokeRect(r.top.x + .6, r.top.y + .6, r.top.w - 1.2, r.top.h - 1.2);
  ctx.fillStyle = 'rgba(255,240,210,.22)'; ctx.fillRect(r.top.x, r.top.y, r.top.w, .6);
  ctx.fillStyle = '#7a5a32';
  for (let i = r.face.y + 2; i < r.face.y + r.face.h - .5; i += 2.4) ctx.fillRect(r.face.x + .8, i, r.face.w - 1.6, .4);
  ctx.strokeStyle = '#6b4e2b'; ctx.lineWidth = .9; ctx.strokeRect(r.face.x + .6, r.face.y + .6, r.face.w - 1.2, r.face.h - 1.2);
  ctx.beginPath(); ctx.moveTo(r.face.x + 1, r.face.y + r.face.h - 1); ctx.lineTo(r.face.x + r.face.w - 1, r.face.y + 1); ctx.stroke();
  if (stacked) { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(r.face.x, r.face.y + r.face.h / 2, r.face.w, .8); }
  if (n > .3 && n < .45) { ctx.fillStyle = 'rgba(40,28,16,.6)'; ctx.fillRect(r.face.x + 4, r.face.y + r.face.h * .4, 6, .8); ctx.fillRect(r.face.x + 5, r.face.y + r.face.h * .4 + 1.4, 4, .6); }
  else if (n > .45 && n < .52) { ctx.fillStyle = 'rgba(176,64,52,.75)'; ctx.fillRect(r.face.x + 4, r.face.y + 1.4, 6, 2.2); }
  grime(ctx, r.face, tx, ty, .2);
}

function paintLocker(ctx, tx, ty) {
  const r = block(ctx, 1, TILE - 1, 3, TILE - 1, HEIGHT.locker, '#8fa1b2', '#73869a');
  const f = r.face;
  ctx.fillStyle = '#5d6f82'; ctx.fillRect(f.x + f.w / 2 - .3, f.y + .5, .6, f.h - 1);
  ctx.fillStyle = '#4e5d6c';
  for (let i = 0; i < 3; i++) { ctx.fillRect(f.x + 2, f.y + 1.5 + i * 1.1, 3.4, .4); ctx.fillRect(f.x + f.w / 2 + 1.6, f.y + 1.5 + i * 1.1, 3.4, .4); }
  ctx.fillStyle = '#cfd6dc'; ctx.fillRect(f.x + f.w / 2 - 1.6, f.y + f.h * .5, .6, 1.8); ctx.fillRect(f.x + f.w / 2 + 1, f.y + f.h * .5, .6, 1.8);
  ctx.fillStyle = '#e9e2cf'; ctx.fillRect(f.x + 2, f.y + f.h - 3, 2.4, 1.1);
  ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(r.top.x, r.top.y, r.top.w, .5);
  grime(ctx, f, tx, ty, .18);
}

function paintFurniture(ctx, tx, ty) {
  const zone = zoneNear(tx, ty), sector = ZONE_BY_ID[zone]?.sector, n = hash(tx, ty);
  const start = tileAt(tx - 1, ty) !== 'B', end = tileAt(tx + 1, ty) !== 'B';
  const x0 = start ? 1 : 0, x1 = end ? TILE - 1 : TILE;
  if (zone === 'bunks') {
    const r = block(ctx, x0, x1, 3, 13, 6, '#a39e88', '#5b574b');
    if (start) { ctx.fillStyle = '#e1dac6'; ctx.fillRect(r.top.x + 1, r.top.y + 1, 4, r.top.h - 2); }
    else { ctx.fillStyle = '#4f6d80'; ctx.fillRect(r.top.x, r.top.y + .6, r.top.w - (end ? 1 : 0), r.top.h - 1.2); ctx.fillStyle = '#668ba3'; ctx.fillRect(r.top.x, r.top.y + .6, r.top.w - (end ? 1 : 0), .7); }
    ctx.fillStyle = '#4a463c'; ctx.fillRect(r.face.x, r.face.y + r.face.h - 1, r.face.w, 1);
    return;
  }
  if (zone === 'server') {
    // Server racks: tall, dark, with a face of status lights (lit live by the fixtures pass).
    const r = block(ctx, .6, TILE - .6, 2, TILE - 1, 20, '#3d464c', '#2a3237');
    ctx.fillStyle = '#1d2327'; for (let i = r.face.y + 1; i < r.face.y + r.face.h - 1; i += 2.2) ctx.fillRect(r.face.x + 1, i, r.face.w - 2, 1.4);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(r.top.x, r.top.y, r.top.w, .5);
    return;
  }
  if (sector === 'lab') {
    const r = block(ctx, x0, x1, 4, 13, 8, '#ccd3d7', '#98a1a6');
    ctx.fillStyle = '#e6eaec'; ctx.fillRect(r.top.x, r.top.y, r.top.w, .6);
    ctx.fillStyle = '#7d868b'; ctx.fillRect(r.face.x, r.face.y + 1.2, r.face.w, .5);
    if (n > .55) {
      // A monitor standing at the back of the bench; its screen glows in the fixtures pass.
      ctx.fillStyle = '#20262a'; ctx.fillRect(4, r.top.y - 5.6, 8, 5.2); ctx.fillStyle = '#2f363a'; ctx.fillRect(7.4, r.top.y - .5, 1.2, 1.4);
    } else if (n > .3) {
      ctx.fillStyle = '#2b3236'; ctx.beginPath(); ctx.arc(6, r.top.y + 3, 2, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#596369'; ctx.fillRect(5.4, r.top.y - 2.4, 1.2, 4);
      ctx.fillStyle = 'rgba(110,200,220,.8)'; ctx.fillRect(10.4, r.top.y + 1.4, 1.6, 2.4);
    } else for (let i = 0; i < 3; i++) { ctx.fillStyle = ['rgba(110,200,220,.85)', 'rgba(170,220,120,.85)', 'rgba(230,190,110,.85)'][i]; ctx.fillRect(3.6 + i * 3.4, r.top.y + 1.2, 1.4, 2.6); }
    return;
  }
  if (zone === 'mess' || zone === 'breakroom') {
    const r = block(ctx, x0, x1, 3, 14, 7, '#9b917b', '#776d5b');
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(r.top.x, r.top.y, r.top.w, .5);
    if (n > .4) { ctx.fillStyle = '#c2bcad'; ctx.fillRect(r.top.x + 2, r.top.y + 2, 5, 3.4); ctx.fillStyle = '#8d4a3a'; ctx.fillRect(r.top.x + 3.6, r.top.y + 3, 1.6, 1.2); }
    ctx.fillStyle = '#e4ddcc'; ctx.beginPath(); ctx.arc(r.top.x + 11 + n * 2, r.top.y + 4 + n * 2, 1.2, 0, Math.PI * 2); ctx.fill();
    return;
  }
  // A desk: papers, or a monitor where someone watches the cameras.
  const screens = zone === 'security' || zone === 'checkpoint';
  const r = block(ctx, x0, x1, 3, 13, 7, '#86643f', '#60472e');
  ctx.fillStyle = '#9c7650'; ctx.fillRect(r.top.x, r.top.y, r.top.w, .6);
  if (screens) { ctx.fillStyle = '#1f2427'; ctx.fillRect(3.6, r.top.y - 5.4, 8.8, 5.4); ctx.fillStyle = '#3a3f42'; ctx.fillRect(3.4, r.top.y + 2, 9, 1.8); }
  else { ctx.fillStyle = '#e0dbce'; ctx.fillRect(r.top.x + 2, r.top.y + 1.6, 4, 3.6); ctx.fillRect(r.top.x + 7.4, r.top.y + 2.4, 4, 3.6); }
}

function paintTerminal(ctx) {
  const r = block(ctx, .4, TILE - .4, 2, TILE - .5, HEIGHT.terminal, '#3b444a', '#283036');
  ctx.fillStyle = '#14191c'; ctx.fillRect(r.face.x + 1.6, r.face.y + 1, r.face.w - 3.2, r.face.h * .45);
  ctx.fillStyle = '#1d2327'; for (let i = r.face.y + r.face.h * .55; i < r.face.y + r.face.h - 1; i += 1.4) ctx.fillRect(r.face.x + 1.6, i, r.face.w - 3.2, .8);
  ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(r.top.x, r.top.y, r.top.w, .5);
}

function paintPanel(ctx) {
  const r = block(ctx, .6, TILE - .6, 3, TILE - 1, HEIGHT.panel, '#4c5a5c', '#3a4648');
  ctx.fillStyle = '#151b1d'; ctx.fillRect(r.top.x + 1.4, r.top.y + 1, 5.6, r.top.h - 2.4); ctx.fillRect(r.top.x + 8.4, r.top.y + 1, 5.6, r.top.h - 2.4);
  const buttons = ['#c9a640', '#5fb38a', '#f0705e', '#8fb7d8'];
  for (let i = 0; i < 4; i++) { ctx.fillStyle = buttons[i]; ctx.fillRect(r.face.x + 2.4 + i * 2.6, r.face.y + 1.6, 1.2, 1); }
}

function paintFence(ctx, tx, ty, cut) {
  // A chain-link panel standing on the tile's centre line.
  const d = TILE / 2, h = HEIGHT.fence, base = d * K, topY = base - h * V;
  ctx.save();
  if (cut) { ctx.beginPath(); ctx.rect(0, topY - 1, 5.5, h * V + 2); ctx.rect(10.5, topY - 1, 5.5, h * V + 2); ctx.clip(); }
  ctx.strokeStyle = 'rgba(184,192,198,.55)'; ctx.lineWidth = .35; ctx.beginPath();
  for (let i = -h; i < TILE + h; i += 1.8) { ctx.moveTo(i, topY); ctx.lineTo(i + h * V, base); ctx.moveTo(i + h * V, topY); ctx.lineTo(i, base); }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#9aa3ab'; ctx.fillRect(0, topY, TILE, .6);
  ctx.fillStyle = 'rgba(150,158,165,.6)'; ctx.fillRect(0, base - .5, TILE, .4);
  if (tx % 2 === 0) { ctx.fillStyle = '#a9b2ba'; ctx.fillRect(.2, topY - 1.6, 1.3, h * V + 1.6); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(1.5, topY - 1, .5, h * V + 1); }
  if (cut) {
    ctx.strokeStyle = 'rgba(200,206,212,.75)'; ctx.lineWidth = .4; ctx.beginPath();
    ctx.moveTo(5.5, topY + 3); ctx.quadraticCurveTo(7.4, topY + 1.4, 7, topY - .6);
    ctx.moveTo(10.5, base - 2); ctx.quadraticCurveTo(8.6, base, 9.4, base + 1); ctx.stroke();
  }
}

/* ── props ─────────────────────────────────────────────────────────────── */

const propImage = typeof Image !== 'undefined' ? Object.assign(new Image(), { src: PROP_SHEET }) : null;
const PROP_AT = new Map(PROPS.map(prop => [prop.ty * COLS + prop.tx, prop]));
const PROP_TILES = new Set(['W', 'Y', 'S', 'x']);
const PROP_HEIGHT = { W: 16, Y: 11, S: 10, x: 12 };

/** A rendered prop from the sheet, its north-west ground corner on the prop's first tile. Projected units. */
function drawProp(ctx, prop) {
  const cell = PROP_SPRITES[prop.sprite], x = prop.tx * TILE, y = prop.ty * TILE * K;
  if (cell && propImage?.complete && propImage.naturalWidth) {
    const smooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(propImage, cell.x, cell.y, cell.w, cell.h, x - cell.ox / SPRITE_PX, y - cell.oy / SPRITE_PX, cell.w / SPRITE_PX, cell.h / SPRITE_PX);
    ctx.imageSmoothingEnabled = smooth;
    return;
  }
  block(ctx, x, x + prop.w * TILE, prop.ty * TILE, (prop.ty + prop.h) * TILE, PROP_HEIGHT[prop.ch] || 10, '#5b5650', '#45413c');
}

/** Flames over the fire barrel and embers rising off them. Additive, after the scene is lit. Projected units. */
export function drawFires(ctx, time, view, reduceMotion = false) {
  for (const prop of PROPS) {
    const fire = PROP_SPRITES[prop.sprite]?.fire;
    if (!fire) continue;
    const x = prop.tx * TILE + fire.x, y = (prop.ty * TILE + fire.y) * K - fire.z * V;
    if (x < view.sx - 30 || x > view.sx + view.vw + 30) continue;
    const t = reduceMotion ? 0 : time;
    // A warm pool on the ground around the barrel: firelight brightens, it does not only tint.
    const gx = prop.tx * TILE + fire.x, gy = (prop.ty * TILE + fire.y) * K, flicker = .85 + .15 * Math.sin(t * 9.1) * Math.sin(t * 3.7);
    ctx.save(); ctx.translate(gx, gy); ctx.scale(1, K);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 56);
    pool.addColorStop(0, `rgba(255,140,60,${(.26 * flicker).toFixed(3)})`); pool.addColorStop(.45, `rgba(255,110,40,${(.1 * flicker).toFixed(3)})`); pool.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = pool; ctx.fillRect(-56, -56, 112, 112);
    ctx.restore();
    const halo = ctx.createRadialGradient(x, y - 2, 0, x, y - 2, 18);
    halo.addColorStop(0, 'rgba(255,150,60,.5)'); halo.addColorStop(.4, 'rgba(255,110,40,.16)'); halo.addColorStop(1, 'rgba(255,90,30,0)');
    ctx.fillStyle = halo; ctx.fillRect(x - 18, y - 20, 36, 36);
    for (let i = 0; i < 5; i++) {
      const phase = t * (6 + i * 1.7) + i * 2.1, lick = 4.5 + Math.sin(phase) * 1.6 + i % 2 * 1.5;
      const fx = x + (i - 2) * 1.4 + Math.sin(phase * .7) * .6;
      ctx.fillStyle = i < 2 ? 'rgba(255,214,120,.75)' : 'rgba(255,120,40,.55)';
      ctx.beginPath(); ctx.moveTo(fx - 1.6, y); ctx.quadraticCurveTo(fx - 1.2, y - lick * .6, fx + Math.sin(phase) * .8, y - lick); ctx.quadraticCurveTo(fx + 1.2, y - lick * .6, fx + 1.6, y); ctx.closePath(); ctx.fill();
    }
    if (reduceMotion) continue;
    for (let i = 0; i < 6; i++) {
      const life = (t * .7 + i / 6) % 1, ex = x + Math.sin(t * 2 + i * 4) * 3 * life + (hash(i, 3) - .5) * 4, ey = y - 3 - life * 22;
      ctx.fillStyle = `rgba(255,170,80,${(.9 * (1 - life)).toFixed(3)})`;
      ctx.fillRect(ex, ey, .7, .7);
    }
  }
}

/** Where each standing tile sits in the sort, measured on the ground (south edge for boxes, centre line for fences). */
const sortDepth = (ch, ty) => (ch === 'F' || ch === 'f' ? ty * TILE + TILE / 2 : (ty + 1) * TILE);
const SOLID = new Set(['#', 'C', 'B', 'L', 'O', 'P', 'F', 'f']);

let cache = new Map(), cacheScale = 0;
/** The tile's standing object, painted once at this scale. Origin: the tile's north-west ground corner, projected. */
function tileSprite(tx, ty, scale) {
  if (cacheScale !== scale) { cache = new Map(); cacheScale = scale; }
  const key = ty * COLS + tx;
  if (cache.has(key)) return cache.get(key);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil((TILE + PAD * 2) * scale); canvas.height = Math.ceil((FK + HEAD + PAD) * scale);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, PAD * scale, HEAD * scale);
  const ch = MAP[ty][tx];
  if (ch === '#') paintWall(ctx, tx, ty);
  else if (ch === 'C') paintCrate(ctx, tx, ty);
  else if (ch === 'B') paintFurniture(ctx, tx, ty);
  else if (ch === 'L') paintLocker(ctx, tx, ty);
  else if (ch === 'O') paintTerminal(ctx);
  else if (ch === 'P') paintPanel(ctx);
  else if (ch === 'F' || ch === 'f') paintFence(ctx, tx, ty, ch === 'f');
  cache.set(key, canvas);
  return canvas;
}

/* ── live pieces ───────────────────────────────────────────────────────── */

function drawDoor(ctx, sim, door) {
  const x = door.tx * TILE, y = door.ty * TILE;
  const vertical = kindAt(door.tx, door.ty - 1).walk === 'none' && kindAt(door.tx, door.ty + 1).walk === 'none';
  const slide = door.open * (TILE / 2 - .5), H = HEIGHT.door;
  const [leaf, inner, edge] = door.locked ? ['#a8745e', '#8a5c49', '#c99a80'] : ['#97a3ad', '#7c8893', '#bac4cc'];
  const slammed = sim.t - (door.slamAt ?? -9);
  if (!vertical) {
    // Leaves in the facade's plane, sliding apart along it.
    const base = (y + TILE) * K - 1, topY = base - H * V;
    for (const [lx, dir] of [[x, -1], [x + TILE / 2, 1]]) {
      const left = lx + dir * slide;
      ctx.fillStyle = leaf; ctx.fillRect(left, topY, TILE / 2, H * V);
      ctx.fillStyle = inner; ctx.fillRect(left + .7, topY + 1, TILE / 2 - 1.4, H * V - 2.4);
      ctx.fillStyle = edge; ctx.fillRect(left, topY, TILE / 2, .5);
      if (door.locked) { ctx.fillStyle = '#d1ab42'; ctx.fillRect(left + 1, topY + H * V * .55, TILE / 2 - 2, .8); }
    }
    if (slammed < .18) { ctx.fillStyle = `rgba(255,240,214,${(.6 * (1 - slammed / .18)).toFixed(3)})`; ctx.fillRect(x - 2, topY - 1, TILE + 4, H * V + 2); }
    return;
  }
  // A door in a north–south wall: seen from above, its leaves are slabs sliding along the wall.
  for (const [ly, dir] of [[y, -1], [y + TILE / 2, 1]]) {
    const north = ly + dir * slide;
    const r = block(ctx, x + 5, x + 11, north, north + TILE / 2, H, leaf, inner);
    ctx.fillStyle = edge; ctx.fillRect(r.top.x, r.top.y, r.top.w, .5);
    if (door.locked) { ctx.fillStyle = '#d1ab42'; ctx.fillRect(r.face.x + .6, r.face.y + r.face.h * .5, r.face.w - 1.2, .7); }
  }
  if (slammed < .18) { ctx.fillStyle = `rgba(255,240,214,${(.6 * (1 - slammed / .18)).toFixed(3)})`; ctx.fillRect(x + 2, y * K - H * V - 2, 12, TILE * K + H * V + 2); }
}

const GRASS_TONES = ['#5f8c48', '#4f7a3c', '#6f9c55', '#46703a', '#588543'];
function drawGrassTile(ctx, sim, time, tx, ty, reduceMotion) {
  const bodies = [sim.player, ...sim.guards.filter(g => !g.down)];
  ctx.lineCap = 'round';
  // A dark tuft at the root of each clump, so it reads as a mass of grass, not single strokes.
  for (let c = 0; c < 3; c++) {
    const cx = tx * TILE + 3 + hash(tx * 3 + c, ty * 5) * 10, cy = (ty * TILE + 4 + hash(tx * 5, ty * 3 + c) * 10) * K;
    ctx.fillStyle = 'rgba(30,48,26,.55)'; ctx.beginPath(); ctx.ellipse(cx, cy, 4.2, 2, 0, 0, Math.PI * 2); ctx.fill();
  }
  for (let i = 0; i < 14; i++) {
    const clump = i % 3, bx = tx * TILE + 3 + hash(tx * 3 + clump, ty * 5) * 10 + (hash(tx * 9 + i, ty) - .5) * 7, by = ty * TILE + 4 + hash(tx * 5, ty * 3 + clump) * 10 + (hash(tx, ty * 9 + i) - .5) * 4;
    const tall = (4 + hash(tx + i, ty + i) * 8) * V;
    let lean = reduceMotion ? 0 : Math.sin(time * 1.7 + bx * .09 + by * .05) * .25 + Math.sin(time * .5 + bx * .02) * .12;
    let flat = 0;
    for (const body of bodies) {
      const dx = bx - body.x, dy = by - body.y, d = Math.hypot(dx, dy);
      if (d < 11) { lean += Math.sign(dx || 1) * (1 - d / 11) * .9; flat = Math.max(flat, 1 - d / 11); }
    }
    const px = bx, py = by * K, height = tall * (1 - flat * .55);
    const curl = (hash(i, tx * 7 + ty) - .5) * 1.6;
    ctx.strokeStyle = GRASS_TONES[(tx + ty + i) % GRASS_TONES.length]; ctx.lineWidth = .9;
    ctx.beginPath(); ctx.moveTo(px, py); ctx.quadraticCurveTo(px + curl + Math.sin(lean) * height * .3, py - height * .6, px + curl * 1.6 + Math.sin(lean) * height, py - Math.cos(lean) * height); ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawTree(ctx, time, tx, ty, reduceMotion) {
  const n = hash(tx, ty), sway = reduceMotion ? 0 : Math.sin(time * .7 + n * 6) * .8;
  const cx = tx * TILE + 8 + (n - .5) * 2, base = (ty * TILE + 9) * K;
  ctx.fillStyle = '#3e3125'; ctx.fillRect(cx - 1.4, base - 12 * V, 2.8, 12 * V);
  const crown = base - HEIGHT.tree * V;
  for (const [color, radius, ox, oy] of [['#27442a', 10.5, 0, 0], ['#305531', 8.4, -1.2, -1.6], ['#3d6a3a', 5.4, -2.4, -3.2], ['#4f8045', 2.6, -3.4, -4.4]]) {
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.ellipse(cx + sway + ox, crown + oy, radius + n * 1.6, (radius + n * 1.6) * .82, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#3d6a3a';
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx + sway + (hash(tx + i, ty) - .5) * 13, crown + (hash(tx, ty + i) - .5) * 9, 2.2, 0, Math.PI * 2); ctx.fill(); }
}

function drawLampPost(ctx, lamp) {
  const x = lamp.x * TILE, base = lamp.y * TILE * K, top = base - 30 * V;
  ctx.fillStyle = '#3a3f44'; ctx.fillRect(x - .7, top, 1.4, base - top);
  ctx.fillStyle = '#565d63'; ctx.fillRect(x - .7, top, .5, base - top);
  ctx.fillStyle = '#2c3135'; ctx.fillRect(x - 3, top - 1.6, 6, 2);
  ctx.fillStyle = 'rgba(4,6,10,.35)'; ctx.beginPath(); ctx.ellipse(x + 1, base + .4, 2.6, 1, 0, 0, Math.PI * 2); ctx.fill();
}

function drawCameraMount(ctx, camera) {
  const x = camera.x, y = camera.y * K - 20 * V;
  ctx.fillStyle = '#4a5058'; ctx.fillRect(x - 2.2, y - 2.2, 4.4, 4.4);
  ctx.save(); ctx.translate(x, y); ctx.scale(1, K); ctx.rotate(camera.angle);
  ctx.fillStyle = camera.on ? '#a3acb4' : '#5d6166'; ctx.fillRect(-.5, -1.8, 6.4, 3.6);
  ctx.fillStyle = '#2a2f34'; ctx.fillRect(5.4, -1.2, 1.2, 2.4);
  ctx.restore();
}

/**
 * Everything standing in view, as { y, draw(ctx) } in projected units (ctx already translated for the camera).
 * `y` is the ground depth used to sort with the actors: whatever stands further south draws later.
 */
export function standingInView(sim, view, time, scale, { reduceMotion = false } = {}) {
  const out = [];
  const tx0 = Math.max(0, Math.floor(view.sx / TILE) - 1), tx1 = Math.min(COLS - 1, Math.ceil((view.sx + view.vw) / TILE) + 1);
  const ty0 = Math.max(0, Math.floor(view.sy / TILE) - 1), ty1 = Math.min(ROWS - 1, Math.ceil((view.sy + view.groundH + HEAD / K) / TILE) + 1);
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const ch = MAP[ty][tx];
    if (PROP_TILES.has(ch)) {
      const prop = PROP_AT.get(ty * COLS + tx);
      if (prop) out.push({ y: (prop.ty + prop.h) * TILE, draw: ctx => drawProp(ctx, prop) });
    } else if (SOLID.has(ch)) {
      out.push({ y: sortDepth(ch, ty), draw: ctx => {
        const sprite = tileSprite(tx, ty, scale);
        ctx.drawImage(sprite, tx * TILE - PAD, ty * FK - HEAD, sprite.width / scale, sprite.height / scale);
      } });
    } else if (ch === '"') out.push({ y: ty * TILE + 14, draw: ctx => drawGrassTile(ctx, sim, time, tx, ty, reduceMotion) });
    else if (ch === 'T') out.push({ y: ty * TILE + 10, draw: ctx => drawTree(ctx, time, tx, ty, reduceMotion) });
  }
  for (const door of sim.doors.values()) {
    if (door.tx < tx0 || door.tx > tx1 || door.ty < ty0 || door.ty > ty1) continue;
    out.push({ y: (door.ty + 1) * TILE - .01, draw: ctx => drawDoor(ctx, sim, door) });
  }
  for (const lamp of LAMPS) {
    if (!isOutdoorLamp(lamp) || lamp.x < tx0 || lamp.x > tx1 + 1 || lamp.y < ty0 || lamp.y > ty1 + 1) continue;
    out.push({ y: lamp.y * TILE, draw: ctx => drawLampPost(ctx, lamp) });
  }
  for (const camera of sim.cameras) out.push({ y: camera.y + 1, draw: ctx => drawCameraMount(ctx, camera) });
  return out;
}

/** The point a lamp hangs from: posts outside, the ceiling inside. Projected units. */
export const lampHead = lamp => ({ x: lamp.x * TILE, y: lamp.y * TILE * K - (lamp.fire ? 14 : isOutdoorLamp(lamp) ? 30.5 : HEIGHT.wall) * V });
/** Soft shadows the standing tiles cast across the ground, painted into the ground layer (ground units). */
export function castShadows(ctx) {
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const ch = MAP[ty][tx];
    if (!SOLID.has(ch) && ch !== 'T' && !PROP_TILES.has(ch)) continue;
    const h = PROP_HEIGHT[ch] || (ch === '#' ? HEIGHT.wall : ch === 'L' ? HEIGHT.locker : ch === 'T' ? 20 : ch === 'F' || ch === 'f' ? 4 : ch === 'B' ? HEIGHT.furniture : HEIGHT.crate);
    // Moonlight from the north-west: shadows fall to the south-east, longer for taller things.
    const dx = h * .32, dy = h * .3, x = tx * TILE, y = ty * TILE;
    ctx.fillStyle = `rgba(6,8,12,${ch === 'T' ? .3 : .26})`;
    ctx.beginPath();
    ctx.moveTo(x + TILE, y); ctx.lineTo(x + TILE + dx, y + dy); ctx.lineTo(x + TILE + dx, y + TILE + dy); ctx.lineTo(x + dx, y + TILE + dy); ctx.lineTo(x, y + TILE); ctx.lineTo(x + TILE, y + TILE);
    ctx.closePath(); ctx.fill();
  }
}

/* ── fixtures that glow ────────────────────────────────────────────────── */

/**
 * Screens and LED banks on the standing objects, in projected units, matching what the sprites paint.
 * `ground` is the floor spot in front of each, where its light falls.
 */
export const FIXTURES = Object.freeze((() => {
  const list = [];
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const ch = MAP[ty][tx], X = tx * TILE, Y = ty * TILE * K, zone = zoneNear(tx, ty), sector = ZONE_BY_ID[zone]?.sector;
    const ground = { x: X + 8, y: (ty + 1) * TILE + 3 };
    if (ch === 'O') {
      const faceY = Y + 15.5 * K - HEIGHT.terminal * V, faceH = HEIGHT.terminal * V;
      list.push({ kind: 'screen', x: X + 1.6, y: faceY + 1, w: 12.8, h: faceH * .45 - 1, color: [110, 230, 196], tx, ty, ground, objective: true });
      list.push({ kind: 'leds', x: X + 1.6, y: faceY + faceH * .55, w: 12.8, h: faceH * .4, color: [110, 230, 196], tx, ty, ground });
    } else if (ch === 'P') {
      const topY = Y + 3 * K - HEIGHT.panel * V, topH = 12 * K;
      list.push({ kind: 'screen', x: X + 2, y: topY + 1.4, w: 4.8, h: topH - 3.2, color: [130, 180, 255], tx, ty, ground, feed: true });
      list.push({ kind: 'screen', x: X + 9, y: topY + 1.4, w: 4.8, h: topH - 3.2, color: [130, 180, 255], tx, ty, ground, feed: true });
    } else if (ch === 'B' && zone === 'server') {
      const faceY = Y + 15 * K - 20 * V;
      list.push({ kind: 'leds', x: X + 1.6, y: faceY + 1, w: 12.8, h: 20 * V - 2, color: [120, 220, 255], tx, ty, ground });
    } else if (ch === 'B' && sector === 'lab' && hash(tx, ty) > .55) {
      const topY = Y + 4 * K - HEIGHT.furniture * V;
      list.push({ kind: 'screen', x: X + 4.6, y: topY - 5, w: 6.8, h: 4, color: [150, 220, 255], tx, ty, ground });
    } else if (ch === 'B' && (zone === 'security' || zone === 'checkpoint')) {
      const topY = Y + 3 * K - 7 * V;
      list.push({ kind: 'screen', x: X + 4.2, y: topY - 4.8, w: 7.6, h: 4.2, color: [130, 180, 255], tx, ty, ground, feed: true });
    }
  }
  return list;
})());

/** Screens flicker and scroll; LEDs blink. Drawn with additive blending after the scene is lit, in projected units. */
export function drawFixtures(ctx, time, view, { breached = false, reduceMotion = false } = {}) {
  const top = view.sy * K - HEAD, bottom = (view.sy + view.groundH) * K + 4;
  for (const f of FIXTURES) {
    if (f.x + f.w < view.sx - 4 || f.x > view.sx + view.vw + 4 || f.y + f.h < top || f.y > bottom) continue;
    const [r, g, b] = f.objective && breached ? [255, 96, 76] : f.color;
    if (f.kind === 'screen') {
      const flicker = reduceMotion ? 1 : .86 + .14 * Math.sin(time * 23 + f.tx * 5.3) * Math.sin(time * 3.1 + f.ty);
      ctx.fillStyle = `rgba(${r},${g},${b},${(.5 * flicker).toFixed(3)})`; ctx.fillRect(f.x, f.y, f.w, f.h);
      ctx.fillStyle = `rgba(${r},${g},${b},${(.35 * flicker).toFixed(3)})`;
      if (f.feed) { const roll = (time * 6 + f.tx * 3) % f.h; ctx.fillRect(f.x, f.y + roll, f.w, .6); }
      else for (let i = .8; i < f.h - .5; i += 1.2) ctx.fillRect(f.x + .6, f.y + i, (f.w - 1.2) * (.4 + .6 * hash(f.tx * 9 + i, Math.floor(time * 2) + f.ty)), .45);
      ctx.fillStyle = `rgba(${r},${g},${b},.1)`; ctx.fillRect(f.x - 1.5, f.y - 1.5, f.w + 3, f.h + 3);
    } else {
      for (let i = .6; i < f.w - .4; i += 1.6) for (let j = .4; j < f.h - .4; j += 1.5) {
        const on = hash(f.tx * 31 + i * 7, f.ty * 17 + j * 3 + Math.floor(time * (2 + hash(i, j) * 5)));
        if (on < .45) continue;
        ctx.fillStyle = hash(i * 3 + f.tx, j * 5) > .86 ? 'rgba(255,90,70,.85)' : `rgba(${r},${g},${b},${(.45 + on * .5).toFixed(3)})`;
        ctx.fillRect(f.x + i, f.y + j, .6, .6);
      }
    }
  }
}

/** Whether a tall standing tile sits just south of a point and hides what stands there. */
export function hiddenBehind(x, y) {
  const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
  for (let row = ty + 1; row <= ty + 2; row++) for (let col = tx - 1; col <= tx + 1; col++) {
    const ch = tileAt(col, row);
    if (!(ch === '#' || ch === 'L' || ch === 'O')) continue;
    if (Math.abs(col * TILE + 8 - x) < 13) return true;
  }
  return false;
}
