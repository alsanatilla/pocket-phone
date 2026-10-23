// Shadow Protocol's facility art. Every tile is painted at full light, in a
// material that belongs to its room, with 2.5D walls, soft contact shadows and
// wear; shadow-light.js then darkens it. Painted once at the play field's pixel
// scale. Also the live dressing of the lit scene (tall grass that sways and
// parts, tree canopies), the fixtures that glow (screens, LEDs, lamps) and the
// atmosphere drawn over everything (fog, dust in the light, moths, film grain).
import { TILE, COLS, ROWS, WORLD_W, WORLD_H, MAP, ZONE_BY_ID, EXTRACTION, LAMPS, kindAt, tileAt, zoneOfTile } from './shadow-level.js';
import { lampColor, lampLevel, isOutdoorLamp, lightLevel } from './shadow-light.js';

export const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };

/** The zone a tile belongs to, or the zone of the open floor beside it (walls and doors have none). */
function zoneNear(tx, ty) {
  const own = zoneOfTile(tx, ty);
  if (own) return own;
  const around = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [dx, dy] of around) if (kindAt(tx + dx, ty + dy).walk !== 'none' && zoneOfTile(tx + dx, ty + dy)) return zoneOfTile(tx + dx, ty + dy);
  for (const [dx, dy] of around) if (zoneOfTile(tx + dx, ty + dy)) return zoneOfTile(tx + dx, ty + dy);
  return null;
}
const sectorNear = (tx, ty) => ZONE_BY_ID[zoneNear(tx, ty)]?.sector || null;

/* ── floors ─────────────────────────────────────────────────────────────── */

function material(tx, ty, ch) {
  if (ch === ':') return 'grate';
  if (ch === ',') return 'grass';
  if (ch === '"') return 'tall';
  if (ch === '=') return 'road';
  if (ch === '_') return 'concrete';
  if (ch === 'X') return 'pad';
  if (ch === 'T' || ch === 'F' || ch === 'f' || ch === '~') return ty <= 30 ? 'concrete' : 'grass';
  const zone = zoneNear(tx, ty), sector = ZONE_BY_ID[zone]?.sector;
  // The gate booth is the one roofed room in the yard.
  if ((sector === 'yard' || sector === 'north') && '.DKB'.includes(ch)) return 'warmtile';
  if (sector === 'yard' || sector === 'north') return 'concrete';
  if (sector === 'exterior') return 'grass';
  if (zone === 'server') return 'raised';
  if (sector === 'lab') return 'labtile';
  if (zone === 'security' || zone === 'breakroom') return 'carpet';
  if (zone === 'office' || zone === 'mess') return 'warmtile';
  if (zone === 'bunks') return 'planks';
  if (zone === 'warehouse' || zone === 'duct') return 'warehouse';
  return 'lino';
}

function speckle(ctx, x, y, tx, ty, count, light, dark, size = .6) {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = i % 2 ? light : dark;
    ctx.fillRect(x + hash(tx * 3 + i, ty * 5) * (TILE - size), y + hash(tx * 7, ty * 3 + i) * (TILE - size), size, size);
  }
}

function paintFloor(ctx, kind, x, y, tx, ty) {
  const n = hash(tx, ty), m = hash(tx + 31, ty * 7 + 3);
  if (kind === 'lino') {
    ctx.fillStyle = n < .5 ? '#6b7077' : '#6e737a'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#5e636a';
    if (tx % 2 === 0) ctx.fillRect(x, y, .5, TILE);
    if (ty % 2 === 0) ctx.fillRect(x, y, TILE, .5);
    speckle(ctx, x, y, tx, ty, 6, 'rgba(255,255,255,.05)', 'rgba(0,0,0,.08)');
    if (m > .82) { ctx.strokeStyle = 'rgba(28,30,34,.16)'; ctx.lineWidth = .7; ctx.beginPath(); ctx.arc(x + 4 + m * 7, y + 6 + n * 5, 3 + n * 3, .3, 1.9); ctx.stroke(); }
  } else if (kind === 'labtile') {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = (i + j + tx + ty) % 2 ? '#a2aaaf' : '#9aa2a7'; ctx.fillRect(x + i * 8, y + j * 8, 8, 8); }
    ctx.fillStyle = '#868e93'; ctx.fillRect(x, y, TILE, .5); ctx.fillRect(x, y + 8, TILE, .5); ctx.fillRect(x, y, .5, TILE); ctx.fillRect(x + 8, y, .5, TILE);
    speckle(ctx, x, y, tx, ty, 3, 'rgba(255,255,255,.08)', 'rgba(0,0,0,.05)');
  } else if (kind === 'raised') {
    ctx.fillStyle = '#5d6a72'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#6b7880'; ctx.fillRect(x + .5, y + .5, 7, 7); ctx.fillRect(x + 8.5, y + 8.5, 7, 7);
    ctx.fillStyle = '#4a555c';
    for (let i = 2; i < TILE; i += 2.6) for (let j = 2; j < TILE; j += 2.6) ctx.fillRect(x + i, y + j, .5, .5);
  } else if (kind === 'carpet') {
    ctx.fillStyle = n < .5 ? '#4f6163' : '#4d5f61'; ctx.fillRect(x, y, TILE, TILE);
    speckle(ctx, x, y, tx, ty, 14, 'rgba(255,255,255,.05)', 'rgba(0,0,0,.08)', .5);
  } else if (kind === 'warmtile') {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { ctx.fillStyle = hash(tx * 2 + i, ty * 2 + j) < .5 ? '#857b69' : '#7f7564'; ctx.fillRect(x + i * 8, y + j * 8, 8, 8); }
    ctx.fillStyle = '#6a6153'; ctx.fillRect(x, y, TILE, .5); ctx.fillRect(x, y + 8, TILE, .5); ctx.fillRect(x, y, .5, TILE); ctx.fillRect(x + 8, y, .5, TILE);
  } else if (kind === 'planks') {
    for (let row = 0; row < 4; row++) {
      ctx.fillStyle = hash(tx, ty * 4 + row) < .5 ? '#7a6249' : '#735c44';
      ctx.fillRect(x, y + row * 4, TILE, 4);
      ctx.fillStyle = '#56442f'; ctx.fillRect(x, y + row * 4 + 3.6, TILE, .4);
      const cut = hash(tx * 5 + row, ty) * TILE;
      if (hash(tx + row, ty * 9) > .45) ctx.fillRect(x + cut, y + row * 4, .4, 4);
    }
    speckle(ctx, x, y, tx, ty, 4, 'rgba(255,230,190,.06)', 'rgba(40,24,10,.1)');
  } else if (kind === 'warehouse') {
    ctx.fillStyle = n < .5 ? '#77736b' : '#74706a'; ctx.fillRect(x, y, TILE, TILE);
    speckle(ctx, x, y, tx, ty, 8, 'rgba(255,255,255,.05)', 'rgba(0,0,0,.08)');
    if (tx % 4 === 0) { ctx.fillStyle = '#625f58'; ctx.fillRect(x, y, .5, TILE); }
    if (ty % 4 === 0) { ctx.fillStyle = '#625f58'; ctx.fillRect(x, y, TILE, .5); }
  } else if (kind === 'grate') {
    ctx.fillStyle = '#666c74'; ctx.fillRect(x, y, TILE, TILE);
    ctx.fillStyle = '#2b2f34';
    for (let i = 1; i < TILE; i += 2.5) for (let j = 1; j < TILE; j += 4) ctx.fillRect(x + i, y + j, 1.2, 3);
    ctx.fillStyle = '#7b818a'; ctx.fillRect(x, y, TILE, .6); ctx.fillRect(x, y, .6, TILE);
  } else if (kind === 'concrete') {
    ctx.fillStyle = n < .5 ? '#6e706b' : '#6b6d68'; ctx.fillRect(x, y, TILE, TILE);
    speckle(ctx, x, y, tx, ty, 8, 'rgba(255,255,255,.05)', 'rgba(0,0,0,.09)');
    ctx.fillStyle = '#5b5d58';
    if (tx % 3 === 0) ctx.fillRect(x, y, .6, TILE);
    if (ty % 3 === 0) ctx.fillRect(x, y, TILE, .6);
  } else if (kind === 'road') {
    ctx.fillStyle = n < .5 ? '#4c4e51' : '#4a4c4f'; ctx.fillRect(x, y, TILE, TILE);
    speckle(ctx, x, y, tx, ty, 12, 'rgba(255,255,255,.06)', 'rgba(0,0,0,.12)', .5);
    // Tyre tracks run along the road.
    ctx.fillStyle = 'rgba(20,20,22,.12)';
    if (tx === 30 || tx === 32) ctx.fillRect(x + 9, y, 2.2, TILE);
  } else if (kind === 'grass' || kind === 'tall') {
    ctx.fillStyle = kind === 'tall' ? '#3d5833' : n < .5 ? '#43603a' : '#466440'; ctx.fillRect(x, y, TILE, TILE);
    for (let i = 0; i < 7; i++) {
      const gx = x + hash(tx + i * 3, ty) * 15, gy = y + hash(tx, ty + i * 5) * 14 + 1;
      ctx.fillStyle = i % 3 === 0 ? '#38522f' : '#577a46';
      ctx.fillRect(gx, gy, .7, 1.8);
    }
    if (kind === 'grass' && m > .93) { ctx.fillStyle = '#cfc58e'; ctx.fillRect(x + n * 13 + 1, y + m * 12 + 2, 1, 1); }
    if (kind === 'grass' && m < .04) { ctx.fillStyle = '#7d7f78'; ctx.beginPath(); ctx.ellipse(x + 8, y + 9, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'pad') {
    ctx.fillStyle = n < .5 ? '#7d7d75' : '#7a7a72'; ctx.fillRect(x, y, TILE, TILE);
    speckle(ctx, x, y, tx, ty, 6, 'rgba(255,255,255,.06)', 'rgba(0,0,0,.08)');
    ctx.fillStyle = '#5f5f58'; ctx.beginPath(); ctx.arc(x + 8, y + 8, .9, 0, Math.PI * 2); ctx.fill();
  }
}

/** Wear that is not part of a tile's pattern: grime, papers, cracks, oil, puddles, leaves. */
function paintDecal(ctx, kind, x, y, tx, ty) {
  const n = hash(tx * 13 + 1, ty * 17 + 5), m = hash(tx * 3 + 11, ty * 29);
  const indoor = !['grass', 'tall', 'concrete', 'road', 'pad'].includes(kind);
  if (indoor && n > .86) {
    ctx.fillStyle = 'rgba(20,18,16,.09)';
    ctx.beginPath(); ctx.ellipse(x + 8 + (m - .5) * 8, y + 8 + (n - .5) * 8, 4 + m * 4, 2.5 + n * 3, m * 3, 0, Math.PI * 2); ctx.fill();
  }
  const zone = zoneNear(tx, ty);
  if ((zone === 'security' || zone === 'office' || sectorNear(tx, ty) === 'lab') && kind !== 'raised' && m > .9) {
    ctx.save(); ctx.translate(x + 5 + n * 6, y + 5 + m * 6); ctx.rotate((n - .5) * 1.6);
    ctx.fillStyle = '#d9d5c9'; ctx.fillRect(-2, -2.6, 4, 5.2);
    ctx.fillStyle = 'rgba(60,60,70,.35)'; for (let i = 0; i < 3; i++) ctx.fillRect(-1.4, -1.6 + i * 1.3, 2.6, .3);
    ctx.restore();
  }
  if ((kind === 'concrete' || kind === 'road' || kind === 'warehouse') && n < .07) {
    ctx.fillStyle = 'rgba(16,16,20,.2)';
    ctx.beginPath(); ctx.ellipse(x + 8, y + 8, 4 + m * 3, 3 + n * 20, m * 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(90,70,120,.06)'; ctx.beginPath(); ctx.ellipse(x + 7, y + 7, 2.5, 1.6, m, 0, Math.PI * 2); ctx.fill();
  }
  if ((kind === 'concrete' || kind === 'road') && m > .88) {
    ctx.strokeStyle = 'rgba(24,24,26,.32)'; ctx.lineWidth = .45; ctx.beginPath();
    let cx = x + n * 16, cy = y;
    ctx.moveTo(cx, cy);
    for (let i = 1; i <= 4; i++) { cx += (hash(tx + i, ty * i) - .5) * 7; cy += 4; ctx.lineTo(cx, cy); }
    ctx.stroke();
  }
  if (kind === 'concrete' && ty <= 30 && n > .955) {
    // A puddle: dark water with a pale rim where it catches the light.
    ctx.fillStyle = 'rgba(38,48,64,.55)'; ctx.beginPath(); ctx.ellipse(x + 8, y + 9, 6 + m * 4, 3 + m * 2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(190,205,220,.18)'; ctx.lineWidth = .5; ctx.beginPath(); ctx.ellipse(x + 8, y + 9, 6 + m * 4, 3 + m * 2, 0, Math.PI * 1.1, Math.PI * 1.8); ctx.stroke();
  }
  const nearTree = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tileAt(tx + dx, ty + dy) === 'T');
  if ((kind === 'grass' || kind === 'tall') && (nearTree ? n > .3 : n > .9)) {
    for (let i = 0; i < (nearTree ? 4 : 2); i++) {
      ctx.fillStyle = ['#7d5a2c', '#9a6a2e', '#6e4f2a', '#8c7a3a'][i % 4];
      ctx.fillRect(x + hash(tx * 5 + i, ty) * 14, y + hash(tx, ty * 5 + i) * 14, 1.4, .9);
    }
  }
}

/** Soft shadow where floor meets a wall or a piece of furniture. Walls to the north stand tallest. */
function contactShadows(ctx) {
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    if (kindAt(tx, ty).walk === 'none') continue;
    const x = tx * TILE, y = ty * TILE;
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const ch = tileAt(tx + dx, ty + dy), kind = kindAt(tx + dx, ty + dy);
      if (kind.walk !== 'none' || ch === 'F' || ch === 'T') continue;
      const wall = kind.sight === 'block';
      const depth = wall ? (dy === -1 ? 8 : 5) : 4, alpha = wall ? (dy === -1 ? .42 : .3) : .24;
      const x0 = dx === 1 ? x + TILE : x, y0 = dy === 1 ? y + TILE : y;
      const x1 = x0 - dx * depth, y1 = y0 - dy * depth;
      const gradient = ctx.createLinearGradient(x0, y0, dx ? x1 : x0, dy ? y1 : y0);
      gradient.addColorStop(0, `rgba(8,10,14,${alpha})`);
      gradient.addColorStop(1, 'rgba(8,10,14,0)');
      ctx.fillStyle = gradient;
      if (dx) ctx.fillRect(Math.min(x0, x1), y, depth, TILE); else ctx.fillRect(x, Math.min(y0, y1), TILE, depth);
    }
  }
}

/* ── walls and objects ──────────────────────────────────────────────────── */

// Wall tops are the roofline seen from above: dark, with a rim where they catch the room's light.
// The south face is the wall seen at an angle, a step lighter.
const WALLS = {
  lab: ['#3c4247', '#7a858b', '#5fb3c9'], corridors: ['#383c42', '#6b7179', null], warehouse: ['#3b3935', '#6f6b63', 'hazard'],
  barracks: ['#3d3934', '#736b5f', null], north: ['#363a39', '#666c6b', null], yard: ['#363a39', '#666c6b', null], perimeter: ['#323635', '#5f6564', null],
};
function paintWall(ctx, x, y, tx, ty) {
  const sector = tx === 0 || ty === 0 || tx === COLS - 1 ? 'perimeter' : sectorNear(tx, ty) || 'corridors';
  const [top, face, trim] = WALLS[sector] || WALLS.corridors;
  const wallAt = (dx, dy) => tileAt(tx + dx, ty + dy) === '#';
  ctx.fillStyle = top; ctx.fillRect(x, y, TILE, TILE);
  speckle(ctx, x, y, tx, ty, 6, 'rgba(255,255,255,.04)', 'rgba(0,0,0,.08)');
  // A rim of light along every edge that meets open space.
  ctx.fillStyle = 'rgba(214,222,232,.34)';
  if (!wallAt(0, -1)) ctx.fillRect(x, y, TILE, .7);
  if (!wallAt(-1, 0)) ctx.fillRect(x, y, .7, TILE);
  if (!wallAt(1, 0)) ctx.fillRect(x + TILE - .7, y, .7, TILE);
  if (!wallAt(0, 1) && ty < ROWS - 1) {
    // The south face, seen at an angle: panels, a lip and a dark baseboard.
    const h = 6, fy = y + TILE - h;
    ctx.fillStyle = face; ctx.fillRect(x, fy, TILE, h);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x, fy, TILE, .6);
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    for (let i = (tx * 5) % 4 + 1; i < TILE; i += 4) ctx.fillRect(x + i, fy + .6, .45, h - 1.6);
    if (trim === 'hazard') {
      for (let i = 0; i < TILE; i += 3) { ctx.fillStyle = (Math.floor((x + i) / 3) % 2) ? '#c9a640' : '#26231d'; ctx.fillRect(x + i, y + TILE - 2.2, 3, 1.2); }
    } else if (trim) { ctx.fillStyle = trim; ctx.fillRect(x, fy + 2.4, TILE, .7); }
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(x, y + TILE - 1, TILE, 1);
  }
}

function dropShadow(ctx, x, y, w = TILE, h = TILE, ox = 1.6, oy = 2.4) {
  ctx.fillStyle = 'rgba(6,8,12,.38)'; ctx.fillRect(x + ox, y + oy, w - 1, h - 1);
}

function paintCrate(ctx, x, y, tx, ty) {
  const n = hash(tx, ty), metal = n > .62 || ty > 24;
  dropShadow(ctx, x, y);
  if (metal) {
    ctx.fillStyle = '#56786b'; ctx.fillRect(x + .5, y + .5, TILE - 1, TILE - 1);
    for (let i = 1.8; i < TILE - 1; i += 2.6) { ctx.fillStyle = '#486559'; ctx.fillRect(x + i, y + 1.4, .9, TILE - 2.8); ctx.fillStyle = '#6a8d7f'; ctx.fillRect(x + i + .9, y + 1.4, .4, TILE - 2.8); }
    ctx.fillStyle = '#7fa293'; ctx.fillRect(x + .5, y + .5, TILE - 1, .9);
    ctx.fillStyle = '#3c5048'; ctx.fillRect(x + .5, y + TILE - 1.4, TILE - 1, .9);
    ctx.fillStyle = '#34453e'; for (const [cx, cy] of [[1, 1], [13.6, 1], [1, 13.6], [13.6, 13.6]]) ctx.fillRect(x + cx, y + cy, 1.4, 1.4);
    if (n > .8) { ctx.fillStyle = 'rgba(140,82,40,.45)'; ctx.fillRect(x + 3 + n * 6, y + 9, 2.4, 3); }
    return;
  }
  ctx.fillStyle = '#a27b49'; ctx.fillRect(x + .5, y + .5, TILE - 1, TILE - 1);
  ctx.fillStyle = '#87653b';
  for (let i = 4.2; i < TILE - 1; i += 3.8) ctx.fillRect(x + 1.4, y + i, TILE - 2.8, .45);
  ctx.strokeStyle = '#76572f'; ctx.lineWidth = 1.2; ctx.strokeRect(x + 1.1, y + 1.1, TILE - 2.2, TILE - 2.2);
  ctx.strokeStyle = '#8d6a3e'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + 1.6, y + TILE - 1.6); ctx.lineTo(x + TILE - 1.6, y + 1.6); ctx.stroke();
  ctx.fillStyle = '#c4a067'; ctx.fillRect(x + .5, y + .5, TILE - 1, .6); ctx.fillRect(x + .5, y + .5, .6, TILE - 1);
  ctx.fillStyle = '#4a3a26'; for (const [cx, cy] of [[1.5, 1.5], [13.8, 1.5], [1.5, 13.8], [13.8, 13.8]]) ctx.fillRect(x + cx, y + cy, .7, .7);
  if (n < .22) { ctx.fillStyle = 'rgba(40,28,16,.55)'; ctx.fillRect(x + 4, y + 6.2, 8, .8); ctx.fillRect(x + 5, y + 8, 6, .6); }
  else if (n < .3) { ctx.fillStyle = 'rgba(168,70,58,.7)'; ctx.fillRect(x + 4.5, y + 6.5, 7, 2.6); }
}

function paintLocker(ctx, x, y, tx, ty) {
  dropShadow(ctx, x, y);
  ctx.fillStyle = '#75879a'; ctx.fillRect(x + 1, y + .8, TILE - 2, TILE - 1.6);
  ctx.fillStyle = '#8fa1b2'; ctx.fillRect(x + 1, y + .8, TILE - 2, 1);
  ctx.fillStyle = '#5f7082'; ctx.fillRect(x + 7.6, y + 1.8, .8, TILE - 3);
  ctx.fillStyle = '#4e5d6c';
  for (let i = 0; i < 3; i++) { ctx.fillRect(x + 3, y + 3.5 + i * 1.5, 3, .5); ctx.fillRect(x + 10, y + 3.5 + i * 1.5, 3, .5); }
  ctx.fillStyle = '#c9d2da'; ctx.fillRect(x + 6.2, y + 9, .8, 2); ctx.fillRect(x + 9, y + 9, .8, 2);
  ctx.fillStyle = '#e9e2cf'; ctx.fillRect(x + 3, y + 12.4, 2.4, 1.2);
}

function bunk(ctx, x, y, tx, ty) {
  const start = tileAt(tx - 1, ty) !== 'B', end = tileAt(tx + 1, ty) !== 'B';
  dropShadow(ctx, x, y + 2, TILE, TILE - 4);
  ctx.fillStyle = '#5a564a'; ctx.fillRect(x + (start ? .8 : 0), y + 2, TILE - (start ? .8 : 0) - (end ? .8 : 0), TILE - 4);
  ctx.fillStyle = '#a19c86'; ctx.fillRect(x + (start ? 1.6 : 0), y + 3, TILE - (start ? 1.6 : 0) - (end ? 1.6 : 0), TILE - 6);
  if (start) { ctx.fillStyle = '#ddd6c2'; ctx.fillRect(x + 2.4, y + 4, 4, TILE - 8); ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(x + 6, y + 4, .5, TILE - 8); }
  else {
    ctx.fillStyle = '#4e6b7c'; ctx.fillRect(x, y + 3, TILE - (end ? 1.6 : 0), TILE - 6);
    ctx.fillStyle = '#62829a'; ctx.fillRect(x, y + 3, TILE - (end ? 1.6 : 0), .8);
    ctx.fillStyle = 'rgba(0,0,0,.14)'; ctx.fillRect(x + 4 + hash(tx, ty) * 6, y + 3.8, .5, TILE - 7.6);
  }
}

function bench(ctx, x, y, tx, ty) {
  dropShadow(ctx, x, y + 2, TILE, TILE - 4);
  ctx.fillStyle = '#97a0a5'; ctx.fillRect(x, y + 2, TILE, TILE - 4);
  ctx.fillStyle = '#c3cbcf'; ctx.fillRect(x, y + 2, TILE, TILE - 5);
  ctx.fillStyle = '#e1e6e8'; ctx.fillRect(x, y + 2, TILE, .6);
  const n = hash(tx, ty);
  if (n > .55) { ctx.fillStyle = '#22282c'; ctx.fillRect(x + 4.5, y + 3.6, 7, 4.6); ctx.fillStyle = '#3a4248'; ctx.fillRect(x + 7, y + 8.2, 2, 1.2); }
  else if (n > .3) {
    ctx.fillStyle = '#2b3236'; ctx.beginPath(); ctx.arc(x + 6, y + 7, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#596369'; ctx.beginPath(); ctx.arc(x + 6, y + 7, 1, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(110,200,220,.75)'; ctx.beginPath(); ctx.arc(x + 11, y + 6, 1.2, 0, Math.PI * 2); ctx.fill();
  } else {
    for (let i = 0; i < 3; i++) { ctx.fillStyle = ['rgba(110,200,220,.8)', 'rgba(170,220,120,.8)', 'rgba(230,190,110,.8)'][i]; ctx.beginPath(); ctx.arc(x + 4 + i * 3.4, y + 6.5, 1.1, 0, Math.PI * 2); ctx.fill(); }
  }
}

function rack(ctx, x, y) {
  dropShadow(ctx, x, y);
  ctx.fillStyle = '#2d3439'; ctx.fillRect(x + .5, y + .8, TILE - 1, TILE - 1.6);
  ctx.fillStyle = '#3e474d'; ctx.fillRect(x + .5, y + .8, TILE - 1, .8);
  ctx.fillStyle = '#20262a'; for (let i = 3; i < TILE - 2; i += 2.4) ctx.fillRect(x + 1.6, y + i, TILE - 3.2, 1.4);
}

function desk(ctx, x, y, tx, ty, screens) {
  dropShadow(ctx, x, y + 1.5, TILE, TILE - 3);
  ctx.fillStyle = '#6b4e33'; ctx.fillRect(x, y + 1.5, TILE, TILE - 3);
  ctx.fillStyle = '#7d5c3c'; ctx.fillRect(x, y + 1.5, TILE, TILE - 4);
  ctx.fillStyle = '#946f4a'; ctx.fillRect(x, y + 1.5, TILE, .6);
  if (screens) {
    ctx.fillStyle = '#1f2427'; ctx.fillRect(x + 4, y + 3, 8, 5);
    ctx.fillStyle = '#2e3437'; ctx.fillRect(x + 7, y + 8, 2, 1);
    ctx.fillStyle = '#3a3f42'; ctx.fillRect(x + 3.5, y + 10, 9, 2);
  } else {
    ctx.fillStyle = '#ddd8cb'; ctx.fillRect(x + 3, y + 4, 4, 5); ctx.fillRect(x + 8.4, y + 5, 4, 5);
    ctx.fillStyle = 'rgba(60,60,70,.35)'; for (let i = 0; i < 3; i++) ctx.fillRect(x + 3.6, y + 5 + i * 1.3, 2.8, .3);
  }
}

function table(ctx, x, y, tx, ty) {
  dropShadow(ctx, x, y + 1, TILE, TILE - 2);
  ctx.fillStyle = '#857b67'; ctx.fillRect(x, y + 1, TILE, TILE - 2);
  ctx.fillStyle = '#958b76'; ctx.fillRect(x, y + 1, TILE, TILE - 3);
  ctx.fillStyle = '#a69c86'; ctx.fillRect(x, y + 1, TILE, .6);
  const n = hash(tx, ty);
  if (n > .4) { ctx.fillStyle = '#bdb7a7'; ctx.fillRect(x + 3, y + 4, 5, 3.6); ctx.fillStyle = '#8d4a3a'; ctx.beginPath(); ctx.arc(x + 5.5, y + 5.8, .9, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#e4ddcc'; ctx.beginPath(); ctx.arc(x + 11 + n * 2, y + 7 + n * 3, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3d2a1c'; ctx.beginPath(); ctx.arc(x + 11 + n * 2, y + 7 + n * 3, .7, 0, Math.PI * 2); ctx.fill();
}

function paintFurniture(ctx, x, y, tx, ty) {
  const zone = zoneNear(tx, ty), sector = ZONE_BY_ID[zone]?.sector;
  if (zone === 'bunks') bunk(ctx, x, y, tx, ty);
  else if (zone === 'server') rack(ctx, x, y);
  else if (sector === 'lab') bench(ctx, x, y, tx, ty);
  else if (zone === 'mess' || zone === 'breakroom') table(ctx, x, y, tx, ty);
  else desk(ctx, x, y, tx, ty, zone === 'security' || zone === 'checkpoint');
}

function paintTerminal(ctx, x, y) {
  dropShadow(ctx, x, y);
  ctx.fillStyle = '#272e33'; ctx.fillRect(x + .4, y + .6, TILE - .8, TILE - 1.8);
  ctx.fillStyle = '#3b444a'; ctx.fillRect(x + .4, y + .6, TILE - .8, .9);
  ctx.fillStyle = '#161b1e'; ctx.fillRect(x + 2, y + 2.4, TILE - 4, 6);
  ctx.fillStyle = '#1c2226'; for (let i = 10; i < 14; i += 1.6) ctx.fillRect(x + 2, y + i, TILE - 4, .9);
}

function paintPanel(ctx, x, y) {
  dropShadow(ctx, x, y);
  ctx.fillStyle = '#3b4749'; ctx.fillRect(x + .6, y + .8, TILE - 1.2, TILE - 3);
  ctx.fillStyle = '#4c5a5c'; ctx.fillRect(x + .6, y + .8, TILE - 1.2, .8);
  ctx.fillStyle = '#161c1e'; ctx.fillRect(x + 1.8, y + 2.2, 5.6, 4.4); ctx.fillRect(x + 8.6, y + 2.2, 5.6, 4.4);
  ctx.fillStyle = '#2a3133'; ctx.fillRect(x + 2, y + 8.6, TILE - 4, 3.6);
  const buttons = ['#c9a640', '#5fb38a', '#f0705e', '#8fb7d8'];
  for (let i = 0; i < 4; i++) { ctx.fillStyle = buttons[i]; ctx.fillRect(x + 3 + i * 2.6, y + 9.6, 1.2, 1.2); }
}

function paintFence(ctx, x, y, tx, ty, cut) {
  ctx.fillStyle = 'rgba(6,8,12,.25)'; ctx.fillRect(x, y + 10.5, TILE, 1.4);
  ctx.save();
  if (cut) { ctx.beginPath(); ctx.rect(x, y, 5.5, TILE); ctx.rect(x + 10.5, y, 5.5, TILE); ctx.clip(); }
  ctx.strokeStyle = 'rgba(176,186,194,.55)'; ctx.lineWidth = .45; ctx.beginPath();
  for (let i = -TILE; i < TILE; i += 2.4) { ctx.moveTo(x + i, y + 5.5); ctx.lineTo(x + i + 4.5, y + 10); ctx.moveTo(x + i + 4.5, y + 5.5); ctx.lineTo(x + i, y + 10); }
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#8e979f'; ctx.fillRect(x, y + 5.4, TILE, .6);
  ctx.fillStyle = '#7d868e'; ctx.fillRect(x, y + 9.8, TILE, .5);
  if (tx % 2 === 0) { ctx.fillStyle = '#a2abb3'; ctx.fillRect(x + .2, y + 4.4, 1.6, 6.4); ctx.fillStyle = 'rgba(6,8,12,.35)'; ctx.fillRect(x + 1.8, y + 5.4, .9, 5.6); }
  if (cut) {
    ctx.strokeStyle = 'rgba(190,198,205,.7)'; ctx.lineWidth = .45; ctx.beginPath();
    ctx.moveTo(x + 5.5, y + 6); ctx.quadraticCurveTo(x + 7, y + 4.5, x + 6.5, y + 3.5);
    ctx.moveTo(x + 10.5, y + 9.5); ctx.quadraticCurveTo(x + 9, y + 11.5, x + 9.8, y + 12.4); ctx.stroke();
  }
}

function paintCulvert(ctx, x, y, tx, ty) {
  ctx.fillStyle = '#8b8e89'; ctx.fillRect(x + 2, y, 12, TILE);
  ctx.fillStyle = '#16232b'; ctx.fillRect(x + 3.6, y, 8.8, TILE);
  ctx.fillStyle = 'rgba(120,160,180,.25)'; ctx.fillRect(x + 5 + hash(tx, ty) * 4, y + 3 + hash(ty, tx) * 8, 2.6, .4);
  ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x + 2, y, .7, TILE);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x + 13.3, y, .7, TILE);
}

function paintDuct(ctx, x, y, tx, ty) {
  ctx.fillStyle = '#6a737b'; ctx.fillRect(x + .5, y + .5, TILE - 1, TILE - 1);
  ctx.fillStyle = '#88919a'; ctx.fillRect(x + 1.2, y + 1.2, TILE - 2.4, TILE - 2.4);
  ctx.fillStyle = '#a3acb4'; ctx.fillRect(x + 1.2, y + 1.2, TILE - 2.4, .6); ctx.fillRect(x + 1.2, y + 1.2, .6, TILE - 2.4);
  ctx.fillStyle = '#6c757d'; ctx.fillRect(x + 1.2, y + 7.8, TILE - 2.4, .5);
  ctx.fillStyle = '#5c646b'; for (const [cx, cy] of [[2.4, 2.4], [12.8, 2.4], [2.4, 12.8], [12.8, 12.8]]) ctx.fillRect(x + cx, y + cy, .7, .7);
}

function paintTreeBase(ctx, x, y) {
  ctx.fillStyle = 'rgba(4,8,6,.42)'; ctx.beginPath(); ctx.ellipse(x + 10, y + 11, 10, 8.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#4a3a2a'; ctx.beginPath(); ctx.arc(x + 8, y + 8.5, 2.2, 0, Math.PI * 2); ctx.fill();
}

function paintObject(ctx, ch, x, y, tx, ty) {
  if (ch === '#') paintWall(ctx, x, y, tx, ty);
  else if (ch === 'C') paintCrate(ctx, x, y, tx, ty);
  else if (ch === 'B') paintFurniture(ctx, x, y, tx, ty);
  else if (ch === 'L') paintLocker(ctx, x, y, tx, ty);
  else if (ch === 'O') paintTerminal(ctx, x, y);
  else if (ch === 'P') paintPanel(ctx, x, y);
  else if (ch === 'F' || ch === 'f') paintFence(ctx, x, y, tx, ty, ch === 'f');
  else if (ch === '~') paintCulvert(ctx, x, y, tx, ty);
  else if (ch === 'v') paintDuct(ctx, x, y, tx, ty);
  else if (ch === 'T') paintTreeBase(ctx, x, y);
  else if (ch === 'D' || ch === 'K') {
    // Door frames; the sliding leaves are drawn live.
    const vertical = kindAt(tx, ty - 1).walk === 'none' && kindAt(tx, ty + 1).walk === 'none';
    ctx.fillStyle = '#2e3338';
    if (vertical) { ctx.fillRect(x + 4.5, y, 7, 1.2); ctx.fillRect(x + 4.5, y + TILE - 1.2, 7, 1.2); }
    else { ctx.fillRect(x, y + 4.5, 1.2, 7); ctx.fillRect(x + TILE - 1.2, y + 4.5, 1.2, 7); }
    ctx.fillStyle = 'rgba(10,12,14,.35)';
    if (vertical) ctx.fillRect(x + 5, y, 6, TILE); else ctx.fillRect(x, y + 5, TILE, 6);
  }
}

function decorations(ctx) {
  // Paint on the ground: road lines, the helipad, room stencils.
  ctx.fillStyle = 'rgba(226,190,110,.8)';
  for (let y = 25 * TILE; y < 44 * TILE; y += 14) ctx.fillRect(32 * TILE - .7, y, 1.4, 7);
  ctx.fillStyle = 'rgba(236,230,214,.6)'; ctx.fillRect(30 * TILE, 31 * TILE + 7, 4 * TILE, 1.6);
  const [x0, y0, x1, y1] = EXTRACTION.rect;
  const cx = (x0 + x1 + 1) / 2 * TILE, cy = (y0 + y1 + 1) / 2 * TILE;
  ctx.strokeStyle = 'rgba(214,176,96,.85)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 34, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = .7; ctx.beginPath(); ctx.arc(cx, cy, 38, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 4; ctx.lineCap = 'square'; ctx.beginPath();
  ctx.moveTo(cx - 10, cy - 13); ctx.lineTo(cx - 10, cy + 13); ctx.moveTo(cx + 10, cy - 13); ctx.lineTo(cx + 10, cy + 13); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.font = 'bold 7px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(236,230,214,.32)';
  for (const [text, x, y] of [['STORAGE', 10, 16.6], ['LAB', 39.5, 4.4], ['BARRACKS', 50, 16.6], ['SECURITY', 27, 19.5], ['CHECKPOINT', 31.5, 26], ['DOCK', 8.5, 7.5]]) ctx.fillText(text, x * TILE, y * TILE);
  // Yellow safety lines along the warehouse aisles.
  ctx.fillStyle = 'rgba(214,180,80,.5)';
  ctx.fillRect(2 * TILE + 2, 18 * TILE + 14, 17 * TILE - 4, .9);
  ctx.fillRect(2 * TILE + 2, 13 * TILE + 13, 17 * TILE - 4, .9);
}

let staticCanvas = null;
/** The floor and furniture, painted once at the play field's pixel scale so each frame copies it 1:1. */
export function staticLayer(scale = 2) {
  if (staticCanvas && Math.abs(staticCanvas.scale - scale) < .01) return staticCanvas;
  staticCanvas = document.createElement('canvas');
  staticCanvas.scale = scale;
  staticCanvas.width = Math.round(WORLD_W * scale); staticCanvas.height = Math.round(WORLD_H * scale);
  const ctx = staticCanvas.getContext('2d');
  ctx.scale(scale, scale);
  const kinds = [];
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const kind = material(tx, ty, MAP[ty][tx]);
    kinds.push(kind);
    paintFloor(ctx, kind, tx * TILE, ty * TILE, tx, ty);
  }
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) if (kindAt(tx, ty).walk !== 'none') paintDecal(ctx, kinds[ty * COLS + tx], tx * TILE, ty * TILE, tx, ty);
  decorations(ctx);
  contactShadows(ctx);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) paintObject(ctx, MAP[ty][tx], tx * TILE, ty * TILE, tx, ty);
  return staticCanvas;
}

/* ── fixtures that glow ─────────────────────────────────────────────────── */

/** Screens and LED banks, with the light each throws. Matches what the static layer paints. */
export const FIXTURES = Object.freeze((() => {
  const list = [];
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const ch = MAP[ty][tx], x = tx * TILE, y = ty * TILE, zone = zoneNear(tx, ty), sector = ZONE_BY_ID[zone]?.sector;
    if (ch === 'O') {
      list.push({ kind: 'screen', x: x + 2, y: y + 2.4, w: TILE - 4, h: 6, color: [110, 230, 196], tx, ty, objective: true });
      list.push({ kind: 'leds', x: x + 2, y: y + 10, w: TILE - 4, h: 3.4, color: [110, 230, 196], tx, ty });
    } else if (ch === 'P') {
      list.push({ kind: 'screen', x: x + 1.8, y: y + 2.2, w: 5.6, h: 4.4, color: [130, 180, 255], tx, ty, feed: true });
      list.push({ kind: 'screen', x: x + 8.6, y: y + 2.2, w: 5.6, h: 4.4, color: [130, 180, 255], tx, ty, feed: true });
    } else if (ch === 'B' && zone === 'server') list.push({ kind: 'leds', x: x + 1.6, y: y + 3, w: TILE - 3.2, h: TILE - 5, color: [120, 220, 255], tx, ty });
    else if (ch === 'B' && sector === 'lab' && hash(tx, ty) > .55) list.push({ kind: 'screen', x: x + 5, y: y + 4.1, w: 6, h: 3.6, color: [150, 220, 255], tx, ty });
    else if (ch === 'B' && (zone === 'security' || zone === 'checkpoint')) list.push({ kind: 'screen', x: x + 4.5, y: y + 3.5, w: 7, h: 4, color: [130, 180, 255], tx, ty, feed: true });
  }
  return list;
})());

/** Screens flicker and scroll; LEDs blink. Drawn with additive blending after the scene is lit. */
export function drawFixtures(ctx, time, view, { breached = false, reduceMotion = false } = {}) {
  for (const f of FIXTURES) {
    if (f.x + f.w < view.sx - 4 || f.x > view.sx + view.vw + 4 || f.y + f.h < view.sy - 4 || f.y > view.sy + view.vh + 4) continue;
    const [r, g, b] = f.objective && breached ? [255, 96, 76] : f.color;
    if (f.kind === 'screen') {
      const flicker = reduceMotion ? 1 : .86 + .14 * Math.sin(time * 23 + f.tx * 5.3) * Math.sin(time * 3.1 + f.ty);
      ctx.fillStyle = `rgba(${r},${g},${b},${(.5 * flicker).toFixed(3)})`; ctx.fillRect(f.x, f.y, f.w, f.h);
      // A camera feed: dark bands rolling down; a terminal: lines of text.
      ctx.fillStyle = `rgba(${r},${g},${b},${(.35 * flicker).toFixed(3)})`;
      if (f.feed) { const roll = ((time * 6 + f.tx * 3) % f.h); ctx.fillRect(f.x, f.y + roll, f.w, .6); }
      else for (let i = .8; i < f.h - .5; i += 1.2) ctx.fillRect(f.x + .6, f.y + i, (f.w - 1.2) * (.4 + .6 * hash(f.tx * 9 + i, Math.floor(time * 2) + f.ty)), .45);
      ctx.fillStyle = `rgba(${r},${g},${b},.1)`; ctx.fillRect(f.x - 1.5, f.y - 1.5, f.w + 3, f.h + 3);
    } else {
      for (let i = .6; i < f.w - .4; i += 1.6) for (let j = .4; j < f.h - .4; j += 1.5) {
        const on = hash(f.tx * 31 + i * 7, f.ty * 17 + j * 3 + Math.floor(time * (2 + hash(i, j) * 5)));
        if (on < .45) continue;
        const red = hash(i * 3 + f.tx, j * 5) > .86;
        ctx.fillStyle = red ? 'rgba(255,90,70,.85)' : `rgba(${r},${g},${b},${(.45 + on * .5).toFixed(3)})`;
        ctx.fillRect(f.x + i, f.y + j, .6, .6);
      }
    }
  }
}

/** Lamp fixtures and the halo around each bulb. */
export function drawLampGlows(ctx, time, view, reduceMotion = false) {
  LAMPS.forEach((lamp, i) => {
    const x = lamp.x * TILE, y = lamp.y * TILE;
    if (x < view.sx - 30 || x > view.sx + view.vw + 30 || y < view.sy - 30 || y > view.sy + view.vh + 30) return;
    const [r, g, b] = lampColor(lamp), level = lampLevel(i, time, reduceMotion);
    const radius = 6 + lamp.s * 8;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${(.75 * level).toFixed(3)})`);
    gradient.addColorStop(.3, `rgba(${r},${g},${b},${(.25 * level).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.fillStyle = `rgba(255,250,235,${(.9 * level).toFixed(3)})`;
    ctx.fillRect(x - 1.6, y - .5, 3.2, 1);
  });
}

/* ── live dressing in the lit scene ─────────────────────────────────────── */

const GRASS_TONES = ['#5f8c48', '#4f7a3c', '#6f9c55', '#46703a', '#588543'];
/** Tall grass blades sway in the wind and part around anyone walking through. Drawn over bodies so it hides them. */
export function drawGrass(ctx, sim, time, view, reduceMotion = false) {
  const tx0 = Math.max(0, Math.floor(view.sx / TILE)), tx1 = Math.min(COLS - 1, Math.ceil((view.sx + view.vw) / TILE));
  const ty0 = Math.max(0, Math.floor(view.sy / TILE)), ty1 = Math.min(ROWS - 1, Math.ceil((view.sy + view.vh) / TILE));
  const bodies = [sim.player, ...sim.guards.filter(g => !g.down)];
  ctx.lineCap = 'round';
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    if (MAP[ty][tx] !== '"') continue;
    for (let i = 0; i < 9; i++) {
      const bx = tx * TILE + 1 + hash(tx * 9 + i, ty) * 14, by = ty * TILE + 3 + hash(tx, ty * 9 + i) * 13;
      const tall = 4.5 + hash(tx + i, ty + i) * 3.5;
      let lean = reduceMotion ? 0 : Math.sin(time * 1.7 + bx * .09 + by * .05) * .22 + Math.sin(time * .5 + bx * .02) * .12;
      let bend = 0;
      for (const body of bodies) {
        const dx = bx - body.x, dy = by - body.y, d = Math.hypot(dx, dy);
        if (d < 10) { lean += Math.sign(dx || 1) * (1 - d / 10) * .9; bend = Math.max(bend, 1 - d / 10); }
      }
      const tipX = bx + Math.sin(lean) * tall, tipY = by - Math.cos(lean) * tall * (1 - bend * .45);
      ctx.strokeStyle = GRASS_TONES[(tx + ty + i) % GRASS_TONES.length]; ctx.lineWidth = .8;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + Math.sin(lean) * tall * .3, by - tall * .55, tipX, tipY); ctx.stroke();
    }
  }
  ctx.lineCap = 'butt';
}

/** Tree canopies stand over everything on the ground and sway a little. */
export function drawCanopies(ctx, time, view, reduceMotion = false) {
  const tx0 = Math.max(0, Math.floor(view.sx / TILE) - 1), tx1 = Math.min(COLS - 1, Math.ceil((view.sx + view.vw) / TILE) + 1);
  const ty0 = Math.max(0, Math.floor(view.sy / TILE) - 1), ty1 = Math.min(ROWS - 1, Math.ceil((view.sy + view.vh) / TILE) + 1);
  for (const [layer, color, radius, ox, oy] of [[0, '#27442a', 10, 0, 0], [1, '#305531', 8, -1.2, -1.2], [2, '#3d6a3a', 5.2, -2.4, -2.8], [3, '#4f8045', 2.4, -3.4, -4]]) {
    ctx.fillStyle = color;
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (MAP[ty][tx] !== 'T') continue;
      const n = hash(tx, ty), sway = reduceMotion ? 0 : Math.sin(time * .7 + n * 6) * .7;
      const cx = tx * TILE + 8 + sway + (n - .5) * 2, cy = ty * TILE + 7 + sway * .4;
      ctx.beginPath(); ctx.arc(cx + ox * (1 + n * .3), cy + oy, radius + n * 1.6 - layer * .2, 0, Math.PI * 2); ctx.fill();
      if (layer === 2) for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx + (hash(tx + i, ty) - .5) * 12, cy + (hash(tx, ty + i) - .5) * 12, 2, 0, Math.PI * 2); ctx.fill(); }
    }
  }
}

/* ── atmosphere over the lit scene ──────────────────────────────────────── */

let fogPattern = null, fogCanvas = null;
function fogTexture() {
  if (fogCanvas) return fogCanvas;
  // Soft value noise that wraps, so it tiles without seams.
  const size = 128, cells = 8, grid = [];
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) grid.push(hash(i * 3.1 + 7, j * 5.7 + 3));
  const at = (i, j) => grid[((j + cells) % cells) * cells + ((i + cells) % cells)];
  fogCanvas = document.createElement('canvas'); fogCanvas.width = fogCanvas.height = size;
  const ctx = fogCanvas.getContext('2d'), image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x / size * cells, fy = y / size * cells, i = Math.floor(fx), j = Math.floor(fy);
    const sx = fx - i, sy = fy - j, ux = sx * sx * (3 - 2 * sx), uy = sy * sy * (3 - 2 * sy);
    const v = (at(i, j) * (1 - ux) + at(i + 1, j) * ux) * (1 - uy) + (at(i, j + 1) * (1 - ux) + at(i + 1, j + 1) * ux) * uy;
    const k = (y * size + x) * 4;
    image.data[k] = 168; image.data[k + 1] = 182; image.data[k + 2] = 205; image.data[k + 3] = Math.round(Math.max(0, v - .35) * 1.6 * 255);
  }
  ctx.putImageData(image, 0, 0);
  return fogCanvas;
}

const motes = Array.from({ length: 70 }, (_, i) => ({ x: hash(i, 1), y: hash(1, i), drift: .4 + hash(i, i) * .8, phase: hash(i * 3, 7) * 6 }));
/** Ground fog outside the fence, dust that shows only in lamplight, and moths around the yard lamps. */
export function drawAtmosphere(ctx, time, view, reduceMotion = false) {
  const { sx, sy, vw, vh } = view;
  const fogTop = 30.5 * TILE;
  if (sy + vh > fogTop - 4 * TILE) {
    if (!fogPattern) fogPattern = ctx.createPattern(fogTexture(), 'repeat');
    const shift = reduceMotion ? 0 : time * 4;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.translate(shift, shift * .3);
    ctx.fillStyle = fogPattern;
    ctx.globalAlpha = .12;
    ctx.fillRect(sx - shift, Math.max(sy, fogTop) - shift * .3, vw, sy + vh - Math.max(sy, fogTop));
    ctx.globalAlpha = .05;
    ctx.fillRect(sx - shift, Math.max(sy, fogTop - 5 * TILE) - shift * .3, vw, Math.max(0, Math.min(sy + vh, fogTop) - Math.max(sy, fogTop - 5 * TILE)));
    ctx.restore();
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const mote of motes) {
    const t = reduceMotion ? 0 : time;
    const x = sx + ((mote.x * vw + t * 3 * mote.drift) % vw + vw) % vw, y = sy + ((mote.y * vh - t * 2 * mote.drift + Math.sin(t * .8 + mote.phase) * 4) % vh + vh) % vh;
    const light = lightLevel(x, y);
    if (light < .45) continue;
    ctx.fillStyle = `rgba(255,236,200,${((light - .45) * .7 * (.6 + .4 * Math.sin(t * 2 + mote.phase))).toFixed(3)})`;
    ctx.fillRect(x, y, .6, .6);
  }
  if (!reduceMotion) LAMPS.forEach((lamp, i) => {
    if (!isOutdoorLamp(lamp)) return;
    const x = lamp.x * TILE, y = lamp.y * TILE;
    if (x < sx - 20 || x > sx + vw + 20 || y < sy - 20 || y > sy + vh + 20) return;
    for (let k = 0; k < 3; k++) {
      const a = time * (2.3 + k * .7) + i * 2 + k * 2.1, rr = 4 + 3 * Math.sin(time * 1.9 + k * 4 + i);
      ctx.fillStyle = 'rgba(255,240,210,.55)';
      ctx.fillRect(x + Math.cos(a) * rr + Math.sin(a * 2.7) * 1.5, y + Math.sin(a * 1.3) * rr * .8, .7, .7);
    }
  });
  ctx.restore();
}

const grain = [];
/** Film grain over the whole frame, in screen pixels. */
export function drawGrain(ctx, width, height, time, reduceMotion = false) {
  if (!grain.length) for (let f = 0; f < 4; f++) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
    const gctx = canvas.getContext('2d'), image = gctx.createImageData(96, 96);
    for (let i = 0; i < 96 * 96; i++) { const v = Math.floor(hash(i * .37 + f * 101, f * 13 + i * .011) * 255); image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v; image.data[i * 4 + 3] = 255; }
    gctx.putImageData(image, 0, 0);
    grain.push(ctx.createPattern(canvas, 'repeat'));
  }
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = .07;
  ctx.fillStyle = grain[reduceMotion ? 0 : Math.floor(time * 14) % grain.length];
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}
