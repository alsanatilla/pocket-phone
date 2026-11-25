// Shadow Protocol's ground. Every tile's floor is painted at full light, in a
// material that belongs to its room, with wear, soft contact shadows and the
// shadows standing things cast; shadow-light.js then darkens it. Painted once,
// already squashed by the ¾ camera (see shadow-view.js). Standing things live in
// shadow-solids.js. Also the atmosphere drawn over the lit scene: ground fog
// outside the fence, dust in lamplight, moths, film grain.
import { TILE, COLS, ROWS, WORLD_W, WORLD_H, MAP, ZONE_BY_ID, EXTRACTION, LAMPS, PROPS, kindAt, tileAt, zoneOfTile } from './shadow-level.js';
import { lampColor, lampLevel, isOutdoorLamp, lightLevel } from './shadow-light.js';
import { K } from './shadow-view.js';
import { castShadows, lampHead } from './shadow-solids.js';

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
    ctx.fillStyle = n < .5 ? '#6b7077' : '#6e737a'; ctx.fillRect(x, y, TILE + .6, TILE + .6);
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
    ctx.fillStyle = '#5d6a72'; ctx.fillRect(x, y, TILE + .6, TILE + .6);
    ctx.fillStyle = '#6b7880'; ctx.fillRect(x + .5, y + .5, 7, 7); ctx.fillRect(x + 8.5, y + 8.5, 7, 7);
    ctx.fillStyle = '#4a555c';
    for (let i = 2; i < TILE; i += 2.6) for (let j = 2; j < TILE; j += 2.6) ctx.fillRect(x + i, y + j, .5, .5);
  } else if (kind === 'carpet') {
    ctx.fillStyle = n < .5 ? '#4f6163' : '#4d5f61'; ctx.fillRect(x, y, TILE + .6, TILE + .6);
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
    ctx.fillStyle = n < .5 ? '#77736b' : '#74706a'; ctx.fillRect(x, y, TILE + .6, TILE + .6);
    speckle(ctx, x, y, tx, ty, 8, 'rgba(255,255,255,.05)', 'rgba(0,0,0,.08)');
    if (tx % 4 === 0) { ctx.fillStyle = '#625f58'; ctx.fillRect(x, y, .5, TILE); }
    if (ty % 4 === 0) { ctx.fillStyle = '#625f58'; ctx.fillRect(x, y, TILE, .5); }
  } else if (kind === 'grate') {
    ctx.fillStyle = '#666c74'; ctx.fillRect(x, y, TILE + .6, TILE + .6);
    ctx.fillStyle = '#2b2f34';
    for (let i = 1; i < TILE; i += 2.5) for (let j = 1; j < TILE; j += 4) ctx.fillRect(x + i, y + j, 1.2, 3);
    ctx.fillStyle = '#7b818a'; ctx.fillRect(x, y, TILE, .6); ctx.fillRect(x, y, .6, TILE);
  } else if (kind === 'concrete') {
    ctx.fillStyle = n < .5 ? '#6e706b' : '#6b6d68'; ctx.fillRect(x, y, TILE + .6, TILE + .6);
    speckle(ctx, x, y, tx, ty, 8, 'rgba(255,255,255,.05)', 'rgba(0,0,0,.09)');
    ctx.fillStyle = '#5b5d58';
    if (tx % 3 === 0) ctx.fillRect(x, y, .6, TILE);
    if (ty % 3 === 0) ctx.fillRect(x, y, TILE, .6);
  } else if (kind === 'road') {
    ctx.fillStyle = n < .5 ? '#4c4e51' : '#4a4c4f'; ctx.fillRect(x, y, TILE + .6, TILE + .6);
    speckle(ctx, x, y, tx, ty, 12, 'rgba(255,255,255,.06)', 'rgba(0,0,0,.12)', .5);
    // Tyre tracks run along the road.
    ctx.fillStyle = 'rgba(20,20,22,.12)';
    if (tx === 30 || tx === 32) ctx.fillRect(x + 9, y, 2.2, TILE);
  } else if (kind === 'grass' || kind === 'tall') {
    ctx.fillStyle = kind === 'tall' ? '#3d5833' : n < .5 ? '#43603a' : '#466440'; ctx.fillRect(x, y, TILE + .6, TILE + .6);
    for (let i = 0; i < 7; i++) {
      const gx = x + hash(tx + i * 3, ty) * 15, gy = y + hash(tx, ty + i * 5) * 14 + 1;
      ctx.fillStyle = i % 3 === 0 ? '#38522f' : '#577a46';
      ctx.fillRect(gx, gy, .7, 1.8);
    }
    if (kind === 'grass' && m > .93) { ctx.fillStyle = '#cfc58e'; ctx.fillRect(x + n * 13 + 1, y + m * 12 + 2, 1, 1); }
    if (kind === 'grass' && m < .04) { ctx.fillStyle = '#7d7f78'; ctx.beginPath(); ctx.ellipse(x + 8, y + 9, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.fill(); }
  } else if (kind === 'pad') {
    ctx.fillStyle = n < .5 ? '#7d7d75' : '#7a7a72'; ctx.fillRect(x, y, TILE + .6, TILE + .6);
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

/* ── flat things on the ground ──────────────────────────────────────────── */

function paintCulvert(ctx, x, y, tx, ty) {
  ctx.fillStyle = '#8b8e89'; ctx.fillRect(x + 2, y, 12, TILE);
  ctx.fillStyle = '#16232b'; ctx.fillRect(x + 3.6, y, 8.8, TILE);
  ctx.fillStyle = 'rgba(120,160,180,.25)'; ctx.fillRect(x + 5 + hash(tx, ty) * 4, y + 3 + hash(ty, tx) * 8, 2.6, .4);
  ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x + 2, y, .7, TILE);
  ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x + 13.3, y, .7, TILE);
}

function paintDuct(ctx, x, y) {
  // The crawl duct runs at floor level: a riveted channel the operative disappears into.
  ctx.fillStyle = '#5d666e'; ctx.fillRect(x + .5, y, TILE - 1, TILE);
  ctx.fillStyle = '#7c858d'; ctx.fillRect(x + 1.4, y, TILE - 2.8, TILE);
  ctx.fillStyle = '#9aa3ab'; ctx.fillRect(x + 1.4, y, .6, TILE);
  ctx.fillStyle = '#626b73'; ctx.fillRect(x + 1.4, y + 7.8, TILE - 2.8, .5);
  ctx.fillStyle = '#545c63'; for (const cy of [2.4, 12.8]) { ctx.fillRect(x + 2.4, y + cy, .7, .7); ctx.fillRect(x + 12.8, y + cy, .7, .7); }
}

function paintThreshold(ctx, x, y, tx, ty) {
  const vertical = kindAt(tx, ty - 1).walk === 'none' && kindAt(tx, ty + 1).walk === 'none';
  ctx.fillStyle = '#3a3f45';
  if (vertical) ctx.fillRect(x + 4.5, y, 7, TILE); else ctx.fillRect(x, y + 4.5, TILE, 7);
  ctx.fillStyle = 'rgba(10,12,14,.35)';
  if (vertical) ctx.fillRect(x + 7.6, y, .8, TILE); else ctx.fillRect(x, y + 7.6, TILE, .8);
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

/**
 * The yards' grit: rubble, junk, weeds along every wall, oil under the wrecks, scorch round the
 * fire, tyre tracks. Densest in the west lot, the junkyard; lighter in the other yards.
 */
function junkyard(ctx) {
  const yard = (tx, ty) => ['yard', 'north'].includes(ZONE_BY_ID[zoneOfTile(tx, ty)]?.sector) && kindAt(tx, ty).walk === 'all';
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    if (!yard(tx, ty)) continue;
    const x = tx * TILE, y = ty * TILE, lot = zoneOfTile(tx, ty) === 'yard_w', density = lot ? 1 : .45;
    // Rubble and gravel.
    for (let i = 0; i < Math.round(5 * density); i++) {
      const n = hash(tx * 11 + i, ty * 7), m = hash(tx * 5, ty * 13 + i);
      if (n > .55) continue;
      const px = x + m * 15, py = y + hash(tx + i * 3, ty) * 15, r = .5 + hash(i, tx + ty) * 1.2;
      ctx.fillStyle = ['#5b5953', '#6f6b62', '#4a4843', '#7a7468'][i % 4];
      ctx.beginPath(); ctx.moveTo(px - r, py); ctx.lineTo(px - r * .3, py - r); ctx.lineTo(px + r, py - r * .4); ctx.lineTo(px + r * .6, py + r * .7); ctx.closePath(); ctx.fill();
    }
    // Junk: a can, a scrap of paper, a plank, a lone tyre.
    const j = hash(tx * 29 + 3, ty * 31 + 7);
    if (j < .12 * density) { ctx.fillStyle = '#9a9a92'; ctx.fillRect(x + 4 + j * 40, y + 9, 1.6, 1); ctx.fillStyle = '#b44a3a'; ctx.fillRect(x + 4 + j * 40, y + 9, .5, 1); }
    else if (j < .2 * density) { ctx.save(); ctx.translate(x + 8, y + 6); ctx.rotate(j * 9); ctx.fillStyle = '#cfc9b8'; ctx.fillRect(-1.5, -2, 3, 4); ctx.restore(); }
    else if (j < .26 * density) { ctx.save(); ctx.translate(x + 8, y + 10); ctx.rotate(j * 13); ctx.fillStyle = '#6e5232'; ctx.fillRect(-6, -.9, 12, 1.8); ctx.fillStyle = '#5a4128'; ctx.fillRect(-6, -.9, 12, .4); ctx.restore(); }
    else if (j < .3 * density) { ctx.strokeStyle = '#17171a'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(x + 8, y + 8, 3.6, 3.2, 0, 0, Math.PI * 2); ctx.stroke(); }
    // Weeds where the ground meets a wall, a fence or a prop.
    const edge = [[0, -1], [-1, 0], [1, 0], [0, 1]].some(([dx, dy]) => { const ch = tileAt(tx + dx, ty + dy); return ch === '#' || ch === 'F' || ch === 'W' || ch === 'Y' || ch === 'S'; });
    if (edge || (lot && hash(tx, ty * 3) > .8)) {
      for (let i = 0; i < (lot ? 7 : 4); i++) {
        const wx = x + hash(tx * 7 + i, ty) * 15, wy = y + hash(tx, ty * 7 + i) * 15;
        ctx.strokeStyle = i % 3 ? '#4f7240' : '#3d5a31'; ctx.lineWidth = .6;
        ctx.beginPath(); ctx.moveTo(wx, wy + 1.6); ctx.lineTo(wx - 1, wy - 1); ctx.moveTo(wx, wy + 1.6); ctx.lineTo(wx + 1.1, wy - .8); ctx.moveTo(wx, wy + 1.6); ctx.lineTo(wx, wy - 1.6); ctx.stroke();
      }
    }
  }
  // Oil pooled under the wrecks, scorch round the fire barrel.
  for (const prop of PROPS) {
    const cx = (prop.tx + prop.w / 2) * TILE, cy = (prop.ty + prop.h / 2) * TILE;
    if (prop.ch === 'W') {
      const oil = ctx.createRadialGradient(cx + 6, cy + 10, 0, cx + 6, cy + 10, prop.w * 7);
      oil.addColorStop(0, 'rgba(10,10,14,.5)'); oil.addColorStop(.6, 'rgba(30,24,40,.2)'); oil.addColorStop(1, 'rgba(10,10,14,0)');
      ctx.fillStyle = oil; ctx.beginPath(); ctx.ellipse(cx + 6, cy + 10, prop.w * 7, prop.h * 5, .2, 0, Math.PI * 2); ctx.fill();
    } else if (prop.ch === 'x') {
      const scorch = ctx.createRadialGradient(cx, cy, 2, cx, cy, 26);
      scorch.addColorStop(0, 'rgba(12,8,6,.65)'); scorch.addColorStop(.5, 'rgba(30,18,10,.3)'); scorch.addColorStop(1, 'rgba(12,8,6,0)');
      ctx.fillStyle = scorch; ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2); ctx.fill();
      for (let i = 0; i < 12; i++) { ctx.fillStyle = i % 2 ? '#2a221c' : '#4a3a2c'; ctx.fillRect(cx + (hash(i, 9) - .5) * 30, cy + (hash(9, i) - .5) * 24, 1.2, .8); }
    }
  }
  // Tyre tracks curving across the lot from the warehouse door.
  ctx.strokeStyle = 'rgba(16,16,18,.22)'; ctx.lineWidth = 2;
  for (const off of [0, 9]) {
    ctx.beginPath(); ctx.moveTo(10 * TILE + off, 24.8 * TILE);
    ctx.bezierCurveTo(10 * TILE + off, 27 * TILE, 6 * TILE + off, 26.5 * TILE + off * .4, 1 * TILE, 29 * TILE + off * .5); ctx.stroke();
  }
}

let groundCanvas = null;
/** The floor, wear and shadows, painted once at the play field's pixel scale and already squashed by K. */
export function groundLayer(scale = 2) {
  if (groundCanvas && Math.abs(groundCanvas.scale - scale) < .01) return groundCanvas;
  groundCanvas = document.createElement('canvas');
  groundCanvas.scale = scale;
  groundCanvas.width = Math.round(WORLD_W * scale); groundCanvas.height = Math.round(WORLD_H * K * scale);
  const ctx = groundCanvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale * K, 0, 0);
  // An opaque base under everything, so no seam between tiles ever shows the background.
  ctx.fillStyle = '#2a2d31'; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  const kinds = [];
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const kind = material(tx, ty, MAP[ty][tx]);
    kinds.push(kind);
    paintFloor(ctx, kind, tx * TILE, ty * TILE, tx, ty);
  }
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) if (kindAt(tx, ty).walk !== 'none') paintDecal(ctx, kinds[ty * COLS + tx], tx * TILE, ty * TILE, tx, ty);
  decorations(ctx);
  junkyard(ctx);
  contactShadows(ctx);
  castShadows(ctx);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const ch = MAP[ty][tx], x = tx * TILE, y = ty * TILE;
    if (ch === '~') paintCulvert(ctx, x, y, tx, ty);
    else if (ch === 'v') paintDuct(ctx, x, y);
    else if (ch === 'D' || ch === 'K') paintThreshold(ctx, x, y, tx, ty);
  }
  return groundCanvas;
}

/** Lamp heads and the halo around each bulb, in projected units. */
export function drawLampGlows(ctx, time, view, reduceMotion = false) {
  LAMPS.forEach((lamp, i) => {
    const head = lampHead(lamp), x = head.x, y = head.y;
    if (x < view.sx - 30 || x > view.sx + view.vw + 30 || y < view.sy * K - 40 || y > (view.sy + view.groundH) * K + 30) return;
    const [r, g, b] = lampColor(lamp), level = lampLevel(i, time, reduceMotion);
    const radius = 6 + lamp.s * 8;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${r},${g},${b},${(.75 * level).toFixed(3)})`);
    gradient.addColorStop(.3, `rgba(${r},${g},${b},${(.25 * level).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.fillStyle = `rgba(255,250,235,${(.9 * level).toFixed(3)})`;
    ctx.fillRect(x - 1.8, y - .5, 3.6, 1);
  });
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
