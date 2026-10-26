// Shadow Protocol's first-person view. The simulation stays flat and
// deterministic; this module only draws the same world from the operative's
// eyes. It is a 2.5D raycaster in the Wolfenstein/Doom tradition: the tile map
// supplies walls and doors, sprites are billboards, and the existing light grid
// decides how dark each surface is.
import { TILE, COLS, ROWS, PROPS, kindAt, tileAt, toTile, zoneOfTile, ZONE_BY_ID } from './shadow-level.js';
import { wrapAngle } from './shadow-nav.js';
import { actorFrame, actorImage, actorImageLoaded } from './shadow-actors.js';
import { SHADOW_SPRITES } from '../shared/shadow-sprites.js';
import { PROP_SPRITES, PROP_SHEET } from '../shared/shadow-props.js';

export const FPS_FOV = 68 * Math.PI / 180;
export const FPS_EYE = 14;
const MAX_DIST = 26 * TILE;
const WALL_H = 26;
const LOW = new Set(['C', 'B', 'W', 'Y', 'S', 'x']);
const COVER = [];
for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
  const ch = tileAt(tx, ty);
  if (ch === 'C' || ch === 'B') COVER.push({ x: (tx + .5) * TILE, y: (ty + .5) * TILE, ch });
}

const SECTOR_WALL = {
  lab: [86, 112, 134], warehouse: [120, 100, 74], corridors: [94, 104, 114], barracks: [128, 106, 80],
  yard: [96, 98, 92], north: [86, 98, 108], exterior: [68, 80, 70], perimeter: [80, 86, 78],
};

const propImage = typeof Image !== 'undefined' ? new Image() : null;
if (propImage) propImage.src = PROP_SHEET;

const rgb = (c, shade = 1) => `rgb(${Math.max(0, Math.min(255, Math.round(c[0] * shade)))},${Math.max(0, Math.min(255, Math.round(c[1] * shade)))},${Math.max(0, Math.min(255, Math.round(c[2] * shade)))})`;

function blocks(sim, tx, ty, ch) {
  if (ch === 'D' || ch === 'K') return !sim.doorOpen(tx, ty);
  if (LOW.has(ch)) return false;
  const kind = kindAt(tx, ty);
  return kind.walk === 'none' && kind.sight === 'block';
}

/** Cast one ray through the tile grid. Returns the first full-height surface. */
export function castRay(sim, px, py, angle, maxDist = MAX_DIST) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  let mapX = toTile(px), mapY = toTile(py);
  const deltaX = Math.abs(dx) < 1e-8 ? Infinity : Math.abs(TILE / dx);
  const deltaY = Math.abs(dy) < 1e-8 ? Infinity : Math.abs(TILE / dy);
  const stepX = dx < 0 ? -1 : 1, stepY = dy < 0 ? -1 : 1;
  let sideX = dx < 0 ? (px - mapX * TILE) / -dx : ((mapX + 1) * TILE - px) / dx;
  let sideY = dy < 0 ? (py - mapY * TILE) / -dy : ((mapY + 1) * TILE - py) / dy;
  let side = 0, dist = 0;
  for (let guard = 0; guard < 96; guard++) {
    if (sideX < sideY) { dist = sideX; sideX += deltaX; mapX += stepX; side = 0; }
    else { dist = sideY; sideY += deltaY; mapY += stepY; side = 1; }
    if (dist > maxDist) return null;
    if (mapX < 0 || mapY < 0 || mapX >= COLS || mapY >= ROWS) return null;
    const ch = tileAt(mapX, mapY);
    if (blocks(sim, mapX, mapY, ch)) {
      const hitX = px + dx * dist, hitY = py + dy * dist;
      return { dist, side, ch, tx: mapX, ty: mapY, x: hitX, y: hitY, frac: side === 0 ? (hitY / TILE) % 1 : (hitX / TILE) % 1 };
    }
  }
  return null;
}

function wallColor(ch, tx, ty) {
  if (ch === 'T') return [44, 62, 42];
  if (ch === 'L') return [78, 84, 88];
  if (ch === 'D' || ch === 'K') return [118, 124, 130];
  if (ch === 'F' || ch === 'f') return [116, 124, 126];
  const zone = zoneOfTile(tx, ty);
  return SECTOR_WALL[ZONE_BY_ID[zone]?.sector] || [78, 80, 78];
}

function projectSprite(sim, x, y, yaw, W, H, horizon) {
  const dx = x - sim.player.x, dy = y - sim.player.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 2 || dist > MAX_DIST) return null;
  const rel = wrapAngle(Math.atan2(dy, dx) - yaw);
  if (Math.abs(rel) > FPS_FOV / 2 + .22) return null;
  const sx = W / 2 + Math.tan(rel) / Math.tan(FPS_FOV / 2) * W / 2;
  const ground = horizon + (H * FPS_EYE) / (2 * Math.max(1, dist));
  return { dist, rel, sx, ground };
}

function drawGuardBillboard(ctx, sim, g, yaw, W, H, horizon, zbuf, time, opts) {
  if (g.hidden || g.carried) return;
  const spot = projectSprite(sim, g.x, g.y, yaw, W, H, horizon);
  if (!spot) return;
  const col = Math.max(0, Math.min(W - 1, Math.round(spot.sx)));
  if (spot.dist > (zbuf[col] ?? Infinity) + TILE) return;
  const height = Math.min(H * 2.2, H * 28 / Math.max(1, spot.dist));
  const width = height * SHADOW_SPRITES.cell[0] / SHADOW_SPRITES.cell[1];
  const frame = actorFrame(sim, g, time, wrapAngle(g.facing - yaw - Math.PI / 2));
  const image = actorImage('guard');
  const light = sim.lightAt(g.x, g.y);
  const shade = .55 + .45 * Math.max(0, Math.min(1, light));
  ctx.save();
  ctx.globalAlpha = .8 + .2 * shade;
  if (actorImageLoaded(image)) ctx.drawImage(image, frame.sx, frame.sy, SHADOW_SPRITES.cell[0], SHADOW_SPRITES.cell[1], spot.sx - width / 2, spot.ground - height, width, height);
  else {
    ctx.fillStyle = rgb([102, 108, 76], shade);
    ctx.fillRect(spot.sx - width * .18, spot.ground - height * .62, width * .36, height * .62);
  }
  ctx.restore();
}

function drawProps(ctx, sim, yaw, W, H, horizon, zbuf, time) {
  // Crates and furniture are low cover, not full walls: draw them as short
  // boxes so rooms have something in them without blocking the view.
  for (const item of COVER) {
    const spot = projectSprite(sim, item.x, item.y, yaw, W, H, horizon);
    if (!spot || spot.dist > 13 * TILE) continue;
    const col = Math.max(0, Math.min(W - 1, Math.round(spot.sx)));
    if (spot.dist > (zbuf[col] ?? Infinity) + TILE) continue;
    const height = Math.min(H * .8, H * (item.ch === 'B' ? 8 : 11) / Math.max(1, spot.dist));
    const width = height * 1.25;
    const shade = .5 + .3 * Math.max(0, Math.min(1, sim.lightAt(item.x, item.y)));
    ctx.fillStyle = item.ch === 'B' ? rgb([78, 68, 52], shade) : rgb([104, 82, 52], shade);
    ctx.fillRect(spot.sx - width / 2, spot.ground - height, width, height);
    ctx.fillStyle = rgb([138, 112, 72], shade * 1.15);
    ctx.fillRect(spot.sx - width / 2, spot.ground - height, width, Math.max(1, height * .16));
  }
  for (const prop of PROPS) {
    if (!prop.sprite || !PROP_SPRITES[prop.sprite]) continue;
    const x = (prop.tx + prop.w / 2) * TILE, y = (prop.ty + prop.h / 2) * TILE;
    const spot = projectSprite(sim, x, y, yaw, W, H, horizon);
    if (!spot) continue;
    const col = Math.max(0, Math.min(W - 1, Math.round(spot.sx)));
    if (spot.dist > (zbuf[col] ?? Infinity) + TILE) continue;
    const data = PROP_SPRITES[prop.sprite];
    const height = Math.min(H * 1.4, H * (prop.sprite === 'car' ? 18 : prop.sprite === 'van' ? 20 : 12) / Math.max(1, spot.dist));
    const width = height * data.w / data.h;
    if (propImage?.complete && propImage.naturalWidth > 0) {
      ctx.drawImage(propImage, data.x, data.y, data.w, data.h, spot.sx - width / 2, spot.ground - height, width, height);
    } else {
      ctx.fillStyle = prop.sprite === 'fireBarrel' ? '#8c4a2c' : '#4a4c42';
      ctx.fillRect(spot.sx - width / 2, spot.ground - height, width, height);
    }
    if (prop.sprite === 'fireBarrel' && time > 0) {
      const glow = ctx.createRadialGradient(spot.sx, spot.ground - height * .8, 0, spot.sx, spot.ground - height * .8, height * .8);
      glow.addColorStop(0, 'rgba(255,174,80,.35)'); glow.addColorStop(1, 'rgba(255,174,80,0)');
      ctx.fillStyle = glow; ctx.fillRect(spot.sx - height, spot.ground - height * 1.8, height * 2, height * 1.8);
    }
  }
}

function drawWeapon(ctx, p, W, H, time, opts) {
  const reduce = Boolean(opts.reduceMotion);
  const moving = p.moving ? 1 : 0;
  const bob = reduce ? 0 : Math.sin(p.anim * (p.running ? 17 : 9)) * 3 * moving + Math.sin(time * 2.1) * 1.2;
  const recoil = p.recoil ? Math.sin(Math.min(1, p.recoil / .18) * Math.PI) * 7 : 0;
  const x = W * .76, y = H * .88 + bob + recoil;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = '#1a2022'; ctx.strokeStyle = '#080b0c'; ctx.lineWidth = 3;
  // Forearms.
  ctx.beginPath(); ctx.moveTo(-24, 72); ctx.lineTo(-8, 24); ctx.lineTo(18, 16); ctx.lineTo(34, 66); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2b3b3d';
  ctx.beginPath(); ctx.moveTo(-12, 24); ctx.lineTo(8, 8); ctx.lineTo(24, 20); ctx.lineTo(4, 38); ctx.closePath(); ctx.fill(); ctx.stroke();
  if (p.aiming || time - (p.shotAt ?? -99) < .4) {
    // Pistol.
    ctx.fillStyle = '#252d30'; ctx.fillRect(2, -6, 54, 10);
    ctx.fillStyle = '#39464a'; ctx.fillRect(48, -3, 24, 4);
    ctx.fillStyle = '#111618'; ctx.fillRect(4, 4, 12, 24);
    ctx.fillStyle = '#ecc981'; ctx.fillRect(70, -2, 3, 2);
    if (time - (p.shotAt ?? -99) < .08) {
      ctx.fillStyle = 'rgba(255,224,160,.95)';
      ctx.beginPath(); ctx.moveTo(72, -4); ctx.lineTo(92, 0); ctx.lineTo(72, 4); ctx.closePath(); ctx.fill();
    }
  } else {
    // Knife.
    ctx.rotate(-.28);
    ctx.fillStyle = '#d9d3c2'; ctx.beginPath(); ctx.moveTo(4, 2); ctx.lineTo(66, -8); ctx.lineTo(70, -4); ctx.lineTo(8, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#2a3032'; ctx.fillRect(-8, 1, 16, 8);
  }
  ctx.restore();
}

function drawCrosshair(ctx, W, H, target, moving) {
  const cx = W / 2, cy = H / 2, gap = 5 + (moving ? 2 : 0), len = 6;
  ctx.save();
  ctx.strokeStyle = target ? '#f0705e' : 'rgba(240,233,221,.75)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - gap - len, cy); ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + gap + len, cy);
  ctx.moveTo(cx, cy - gap - len); ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + gap + len);
  ctx.stroke();
  ctx.fillStyle = target ? '#f0705e' : 'rgba(240,233,221,.55)';
  ctx.fillRect(cx - .8, cy - .8, 1.6, 1.6);
  ctx.restore();
}

/**
 * Draw the operative's first-person view. `opts.shake` is the same camera shake
 * the tactical view uses; `opts.target` is the guard under the crosshair.
 */
export function drawFirstPerson(ctx, sim, view, opts = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const p = sim.player, time = sim.t || 0, yaw = p.facing;
  const shakeX = opts.reduceMotion ? 0 : opts.shake?.x || 0, shakeY = opts.reduceMotion ? 0 : opts.shake?.y || 0;
  const horizon = H * .5 + shakeY;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, W, H);

  // Ceiling and floor.
  const ceiling = ctx.createLinearGradient(0, 0, 0, horizon);
  ceiling.addColorStop(0, '#080b10'); ceiling.addColorStop(1, '#131920');
  ctx.fillStyle = ceiling; ctx.fillRect(0, 0, W, horizon);
  const floor = ctx.createLinearGradient(0, horizon, 0, H);
  floor.addColorStop(0, '#111613'); floor.addColorStop(.45, '#1d211c'); floor.addColorStop(1, '#2b2d25');
  ctx.fillStyle = floor; ctx.fillRect(0, horizon, W, H - horizon);

  // A simple perspective floor grid.
  for (let d = TILE * 2; d < MAX_DIST; d += TILE * 2) {
    const y = horizon + (H * FPS_EYE) / (2 * d);
    if (y > H) continue;
    ctx.strokeStyle = `rgba(210,196,158,${(.2 * Math.max(0, 1 - d / MAX_DIST)).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(210,196,158,.09)';
  for (let i = -12; i <= 12; i++) {
    const a = yaw + i * .085, x = W / 2 + Math.tan(a - yaw) / Math.tan(FPS_FOV / 2) * W / 2;
    ctx.beginPath(); ctx.moveTo(W / 2, horizon); ctx.lineTo(x, H); ctx.stroke();
  }
  // A headlamp pool on the floor; the operative is not walking in pitch black.
  const pool = ctx.createRadialGradient(W / 2, H * .72, 0, W / 2, H * .72, H * .62);
  pool.addColorStop(0, 'rgba(238,222,174,.14)'); pool.addColorStop(.55, 'rgba(238,222,174,.05)'); pool.addColorStop(1, 'rgba(238,222,174,0)');
  ctx.fillStyle = pool; ctx.fillRect(0, horizon, W, H - horizon);

  const zbuf = new Float32Array(W);
  const step = W > 1100 ? 2 : 1;
  for (let x = 0; x < W; x += step) {
    const ray = yaw - FPS_FOV / 2 + (x + step / 2) / W * FPS_FOV;
    const hit = castRay(sim, p.x, p.y, ray);
    if (!hit) {
      for (let dx = 0; dx < step && x + dx < W; dx++) zbuf[x + dx] = Infinity;
      continue;
    }
    const corrected = Math.max(1, hit.dist * Math.cos(ray - yaw));
    const ground = horizon + (H * FPS_EYE) / (2 * corrected);
    const wallH = Math.min(H * 3, H * WALL_H / corrected);
    const top = ground - wallH;
    const light = Math.max(0, Math.min(1, sim.lightAt(hit.x, hit.y)));
    const fog = 1 / (1 + corrected / (TILE * 9));
    // The operative carries a small lamp: the centre of the view stays readable
    // even when the room's own lights are out.
    const beam = Math.max(0, 1 - Math.abs(ray - yaw) / (FPS_FOV * .52));
    const shade = (.42 + .2 * beam + .58 * light) * fog * (hit.side ? .8 : 1);
    const color = wallColor(hit.ch, hit.tx, hit.ty);
    ctx.fillStyle = rgb(color, shade);
    ctx.fillRect(x + shakeX * .35, top, step, wallH);
    // Panel seams and a darker base keep the wall from reading as a flat stripe.
    if (hit.frac < .055 || hit.frac > .945) {
      ctx.fillStyle = rgb(color, shade * .62); ctx.fillRect(x + shakeX * .35, top, step, wallH);
    }
    ctx.fillStyle = `rgba(255,255,255,${(.045 * fog).toFixed(3)})`;
    ctx.fillRect(x + shakeX * .35, top, step, Math.max(1, wallH * .035));
    ctx.fillStyle = `rgba(0,0,0,${(.18 * fog).toFixed(3)})`;
    ctx.fillRect(x + shakeX * .35, top + wallH * .52, step, Math.max(1, wallH * .025));
    ctx.fillStyle = `rgba(0,0,0,${(.28 * fog).toFixed(3)})`;
    ctx.fillRect(x + shakeX * .35, ground - Math.max(1, wallH * .045), step, Math.max(1, wallH * .045));
    if (hit.ch === 'D' || hit.ch === 'K') {
      ctx.fillStyle = hit.ch === 'K' ? 'rgba(255,90,70,.85)' : 'rgba(150,210,255,.75)';
      ctx.fillRect(x + shakeX * .35, top + wallH * .48, step, Math.max(1, wallH * .025));
    }
    for (let dx = 0; dx < step && x + dx < W; dx++) zbuf[x + dx] = corrected;
  }

  // Sprites, far to near.
  const guards = sim.guards.map(g => ({ g, d: Math.hypot(g.x - p.x, g.y - p.y) })).sort((a, b) => b.d - a.d);
  for (const { g } of guards) drawGuardBillboard(ctx, sim, g, yaw, W, H, horizon, zbuf, time, opts);
  drawProps(ctx, sim, yaw, W, H, horizon, zbuf, time);

  // The operative's own light: eyes adjusting, and a little muzzle flash.
  const eye = ctx.createRadialGradient(W / 2, H * .58, 0, W / 2, H * .58, H * .72);
  eye.addColorStop(0, 'rgba(220,210,180,.045)'); eye.addColorStop(.55, 'rgba(160,150,120,.018)'); eye.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = eye; ctx.fillRect(0, 0, W, H);
  const flash = time - (p.shotAt ?? -99);
  if (flash >= 0 && flash < .08) {
    ctx.fillStyle = `rgba(255,220,150,${(.22 * (1 - flash / .08)).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
  }

  // Vignette, then the weapon and crosshair.
  const vignette = ctx.createRadialGradient(W / 2, H * .52, H * .18, W / 2, H * .52, H * .82);
  vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  drawWeapon(ctx, p, W, H, time, opts);
  drawCrosshair(ctx, W, H, opts.target, p.moving);
}

/** The point the first-person crosshair is aiming at, in world units. */
export function firstPersonAim(sim, distance = 320) {
  const p = sim.player;
  return { x: p.x + Math.cos(p.facing) * distance, y: p.y + Math.sin(p.facing) * distance };
}
