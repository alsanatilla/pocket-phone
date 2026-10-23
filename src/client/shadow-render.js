// Shadow Protocol's canvas art: the facility, light, vision cones, sprites,
// the proximity scanner and the intel overlay. Drawing only; no game rules.
import { TILE, COLS, ROWS, WORLD_W, WORLD_H, MAP, ZONES, EXTRACTION, kindAt, toTile } from './shadow-level.js';
import { index, wrapAngle } from './shadow-nav.js';
import { drawOperative, drawOperativeGlow, heldGuardPose } from './shadow-operative.js';
import { staticLayer, drawGrass, drawCanopies, drawFixtures, drawLampGlows, drawAtmosphere, drawGrain, FIXTURES } from './shadow-art.js';
import { applyLight } from './shadow-light.js';

export { staticLayer };

export const VIEW_W = 480;
export const VIEW_H = 300;
export const SCALE = 2;
// A stretched view keeps this much floor in sight, whatever the window shape.
export const VIEW_AREA = VIEW_W * VIEW_H;

/** World units in view and canvas pixels per unit, for a play field of the given CSS size. */
export function fitView(width, height, dpr = 1) {
  const aspect = Math.max(.6, Math.min(2.2, width / height));
  const w = Math.min(WORLD_W, Math.round(Math.sqrt(VIEW_AREA * aspect))), h = Math.min(WORLD_H, Math.round(w / aspect));
  const cssW = Math.min(width, height * aspect), cssH = cssW / aspect;
  // Past four canvas pixels per unit the floor layer gets too large to keep; the browser scales the rest.
  const pixels = Math.max(1, Math.round(Math.min(cssW * Math.min(2, dpr), w * 4)));
  return { w, h, cssW, cssH, pixelW: pixels, pixelH: Math.round(pixels * h / w), scale: pixels / w, ui: pixels / cssW };
}

export const STATE_COLORS = Object.freeze({
  patrol: '#e9dcb4', suspicious: '#ecc981', investigate: '#ecc981', alert: '#f0705e', search: '#efa58e',
  lockdown: '#c1aed5', returning: '#a5bfdc', down: '#6b6b6b', dead: '#b34a3b',
});
export const STATE_NAMES = Object.freeze({
  patrol: 'patrol', suspicious: 'suspicious', investigate: 'investigating', alert: 'alert', search: 'searching',
  lockdown: 'lockdown', returning: 'returning', down: 'unconscious', dead: 'dead',
});


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

export function hexAlpha(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255},${(value >> 8) & 255},${value & 255},${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/* ── sprites ───────────────────────────────────────────────────────────── */

// Guards wear olive, painted at full light; the light pass darkens them.
const GUARD = { cloth: '#66724a', shade: '#525d3b', light: '#7f8d5c', vest: '#3f462e', pouch: '#333926', boots: '#25271f', cap: '#3e472f', brim: '#323a27', capLight: '#5b6746', gloves: '#2a2c25', rifle: '#1c1e1f' };

function drawGuard(ctx, g, time, selected, pose = null) {
  ctx.save();
  ctx.translate(g.x, g.y);
  // A guard caught in a strike moves with it; shadow-operative.js choreographs that.
  if (pose) { ctx.translate(pose.dx || 0, pose.dy || 0); if (pose.angle) ctx.rotate(pose.angle); if (pose.scale) ctx.scale(pose.scale, pose.scale); }
  if (g.down) {
    drawFallen(ctx, g, time);
    ctx.restore();
    if (!g.dead && !g.hidden) {
      ctx.fillStyle = 'rgba(193,174,213,.75)'; ctx.font = '5px monospace'; ctx.textAlign = 'center';
      const bob = (time * .8 + g.n * .3) % 1;
      ctx.globalAlpha = 1 - bob; ctx.fillText('z', g.x + 4 + bob * 3, g.y - 6 - bob * 6); ctx.globalAlpha = 1;
    }
    return;
  }
  ctx.fillStyle = 'rgba(4,6,10,.45)'; ctx.beginPath(); ctx.ellipse(.8, 1.8, 6.4, 5.4, 0, 0, Math.PI * 2); ctx.fill();
  const color = STATE_COLORS[g.sees ? 'alert' : g.state] || STATE_COLORS.patrol;
  ctx.strokeStyle = hexAlpha(color, selected ? .95 : .35); ctx.lineWidth = selected ? 1.1 : .6;
  ctx.beginPath(); ctx.ellipse(0, 1.2, 8.2, 7, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.rotate(g.facing);
  const stride = g.moving ? Math.sin(g.anim * (g.state === 'alert' || g.sees ? 16 : 9)) : 0;
  const breathe = g.moving ? 0 : Math.sin(g.anim * 2.2) * .12;
  ctx.fillStyle = GUARD.boots;
  ctx.fillRect(-1.6 + stride * 2.4, -3.7, 3.6, 2.2); ctx.fillRect(-1.6 - stride * 2.4, 1.5, 3.6, 2.2);
  ctx.fillStyle = GUARD.shade; ctx.beginPath(); ctx.ellipse(0, 0, 5.7 + breathe, 4.9 + breathe, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GUARD.cloth; ctx.beginPath(); ctx.ellipse(.4, -.2, 5.1 + breathe, 4.3 + breathe, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GUARD.light; ctx.beginPath(); ctx.ellipse(1.2, -2, 2.6, 1.3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GUARD.vest; ctx.fillRect(-3.6, -3.2, 4.6, 6.4);
  ctx.fillStyle = GUARD.pouch; ctx.fillRect(-3.2, -2.6, 1.6, 1.8); ctx.fillRect(-3.2, .8, 1.6, 1.8);
  // The radio on the shoulder, aerial back.
  ctx.fillStyle = '#1d1f1f'; ctx.fillRect(-2, -4.7, 2.2, 1.4);
  ctx.strokeStyle = '#1d1f1f'; ctx.lineWidth = .35; ctx.beginPath(); ctx.moveTo(-1.6, -4.4); ctx.lineTo(-4.4, -5.6); ctx.stroke();
  // Both hands on the rifle: grip and fore-end.
  ctx.lineCap = 'round';
  ctx.strokeStyle = GUARD.cloth; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(.2, 3.4); ctx.lineTo(4.2, 3); ctx.moveTo(.4, -3.4); ctx.lineTo(6.6, 2); ctx.stroke();
  ctx.strokeStyle = GUARD.rifle; ctx.lineWidth = 1.9; ctx.beginPath(); ctx.moveTo(.4, 2.9); ctx.lineTo(2.6, 2.6); ctx.stroke();
  ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(2.4, 2.6); ctx.lineTo(11, 2.6); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = GUARD.rifle; ctx.fillRect(5.2, 2.7, 1.1, 1.9);
  ctx.fillStyle = '#3a3e41'; ctx.fillRect(9.2, 3.1, 1.9, 1.1);
  ctx.fillStyle = GUARD.gloves; ctx.beginPath(); ctx.arc(4.3, 3, .9, 0, Math.PI * 2); ctx.arc(6.7, 2, .9, 0, Math.PI * 2); ctx.fill();
  // A cap with its brim to the front.
  ctx.fillStyle = GUARD.brim; ctx.beginPath(); ctx.ellipse(3.3, 0, 1.5, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GUARD.cap; ctx.beginPath(); ctx.arc(.8, 0, 3.05, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GUARD.capLight; ctx.beginPath(); ctx.arc(.2, -1, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  if (g.groggy > 0) { ctx.fillStyle = 'rgba(193,174,213,.8)'; ctx.font = '5px monospace'; ctx.textAlign = 'center'; ctx.fillText('~', g.x, g.y - 9); }
}

/** A guard on the floor: knocked out, or dead and falling into place. */
function drawFallen(ctx, g, time) {
  const fall = g.dead ? Math.min(1, Math.max(0, (time - (g.deadAt || 0)) / .32)) : 1;
  const angle = g.facing + (g.dead ? 1.15 + (1 - fall) * .7 : 1.2);
  ctx.fillStyle = 'rgba(4,6,10,.4)'; ctx.beginPath(); ctx.ellipse(.6, 1.2, 8.6, 4.8, angle, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(angle);
  ctx.fillStyle = GUARD.boots; ctx.fillRect(-9.4, -2.9, 2.4, 1.9); ctx.fillRect(-9, 1, 2.4, 1.9);
  ctx.fillStyle = GUARD.shade; ctx.fillRect(-7.2, -2.6, 4.2, 1.8); ctx.fillRect(-7, .8, 4.2, 1.8);
  ctx.lineCap = 'round'; ctx.strokeStyle = GUARD.cloth; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.moveTo(2.2, -3.2); ctx.lineTo(4.2, -6.4); ctx.moveTo(2.2, 3.2); ctx.lineTo(5.6, 5.2); ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = GUARD.shade; ctx.beginPath(); ctx.ellipse(0, 0, 5.2, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GUARD.cloth; ctx.beginPath(); ctx.ellipse(.3, -.3, 4.6, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GUARD.vest; ctx.fillRect(-2.6, -2.8, 4, 5.6);
  if (g.dead) { ctx.fillStyle = '#7a2219'; ctx.beginPath(); ctx.ellipse(.4, .6, 2.2, 1.6, .4, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = GUARD.cap; ctx.beginPath(); ctx.arc(6.6, .2, 2.7, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = GUARD.capLight; ctx.beginPath(); ctx.arc(6.1, -.6, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = GUARD.rifle; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(1.5, 6.6); ctx.lineTo(10.4, 8.8); ctx.stroke();
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
    ctx.fillStyle = stain.pool ? 'rgba(150,30,26,.8)' : 'rgba(176,42,34,.74)';
    ctx.beginPath(); ctx.arc(stain.x, stain.y, r, 0, Math.PI * 2); ctx.fill();
    if (stain.pool) {
      ctx.fillStyle = 'rgba(98,18,16,.6)';
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
    if (slash.whiff) {
      // A cut at the air: a thin crescent in front of the operative.
      ctx.strokeStyle = `rgba(240,233,221,${(1 - k) * .7})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(slash.x, slash.y, 11 + k * 5, slash.angle - .95 + k * .3, slash.angle + .75 + k * .2); ctx.stroke();
      continue;
    }
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
    const [leaf, inner, edge] = door.locked ? ['#9b6f5c', '#83594a', '#bb8d76'] : ['#8c98a3', '#76828d', '#aeb9c2'];
    const panel = (lx, ly, w, h) => {
      ctx.fillStyle = leaf; ctx.fillRect(lx, ly, w, h);
      ctx.fillStyle = inner; ctx.fillRect(lx + .8, ly + .8, w - 1.6, h - 1.6);
      ctx.fillStyle = edge; if (vertical) ctx.fillRect(lx, ly, w, .6); else ctx.fillRect(lx, ly, .6, h);
    };
    if (vertical) { panel(x + 5.5, y - slide, 5, 8); panel(x + 5.5, y + 8 + slide, 5, 8); }
    else { panel(x - slide, y + 5.5, 8, 5); panel(x + 8 + slide, y + 5.5, 8, 5); }
    const slammed = sim.t - (door.slamAt ?? -9);
    if (slammed < .18) {
      ctx.fillStyle = `rgba(255,240,214,${(.55 * (1 - slammed / .18)).toFixed(3)})`;
      ctx.fillRect(x - 2, y - 2, TILE + 4, TILE + 4);
    }
  }
}

function drawProps(ctx, sim, time) {
  // Lockers that were just opened, the keycard on its desk, the cameras on their mounts.
  for (const locker of sim.lockers.values()) {
    if (!locker.openedAt || time - locker.openedAt > 1.5) continue;
    ctx.fillStyle = 'rgba(10,12,14,.9)'; ctx.fillRect(locker.x * TILE + 2, locker.y * TILE + 2, TILE - 4, TILE - 4);
  }
  if (sim.keycardOnDesk) {
    ctx.fillStyle = '#f2d892'; ctx.fillRect(58 * TILE + 5, 14 * TILE + 5, 6, 4);
    ctx.fillStyle = '#12110f'; ctx.fillRect(58 * TILE + 6, 14 * TILE + 6, 2, 1);
  }
  for (const camera of sim.cameras) {
    ctx.fillStyle = 'rgba(4,6,10,.4)'; ctx.fillRect(camera.x - 2, camera.y - 1.5, 6, 6);
    ctx.fillStyle = '#4a5058'; ctx.fillRect(camera.x - 2.5, camera.y - 2.5, 5, 5);
    ctx.save(); ctx.translate(camera.x, camera.y); ctx.rotate(camera.angle);
    ctx.fillStyle = camera.on ? '#9aa3ab' : '#5d6166'; ctx.fillRect(-.5, -1.8, 6.2, 3.6);
    ctx.fillStyle = '#2a2f34'; ctx.fillRect(5.2, -1.2, 1.2, 2.4);
    ctx.restore();
  }
}

/** Small lights that glow on their own: door locks, camera tally lights, guard flashlights and radios, the keycard, the pad. */
function drawLittleLights(ctx, sim, time, onScreen) {
  for (const door of sim.doors.values()) {
    const x = door.tx * TILE + 8, y = door.ty * TILE + 8;
    if (!onScreen(x, y, 10)) continue;
    ctx.fillStyle = door.locked ? (sim.player.keycard ? 'rgba(140,240,160,.9)' : 'rgba(255,90,70,.9)') : 'rgba(150,200,255,.55)';
    ctx.fillRect(x - .6, y - .6, 1.2, 1.2);
  }
  for (const camera of sim.cameras) {
    if (!camera.on || !onScreen(camera.x, camera.y, 10)) continue;
    if (!(camera.track > 0) && !(Math.floor(time * 1.5 + camera.index) % 2)) continue;
    glow(ctx, camera.x + Math.cos(camera.angle) * 5.8, camera.y + Math.sin(camera.angle) * 5.8, 4, [255, 80, 60], .7);
  }
  for (const g of sim.guards) {
    if (g.down || g.grabbed || !onScreen(g.x, g.y, 20)) continue;
    const c = Math.cos(g.facing), s = Math.sin(g.facing);
    // The flashlight lens under the barrel, and the radio's tally light.
    glow(ctx, g.x + c * 11.2 - s * 3.6, g.y + s * 11.2 + c * 3.6, 5, g.sees ? [255, 190, 170] : [255, 240, 205], .9);
    if (Math.floor(time * 1.3 + g.n * .7) % 3 === 0) { ctx.fillStyle = 'rgba(255,70,50,.85)'; ctx.fillRect(g.x - c + s * 4 - .4, g.y - s - c * 4 - .4, .8, .8); }
  }
  if (sim.keycardOnDesk) glow(ctx, 58 * TILE + 9, 14 * TILE + 6, 3 + Math.sin(time * 3), [255, 236, 170], .35 + .25 * Math.sin(time * 3));
  // The pad's edge lights: a steady glow, chasing once the data is out.
  const { cx, cy } = helicopterAt(sim);
  if (onScreen(cx, cy, 60)) for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2, on = sim.player.data ? (Math.floor(time * 10) % 12 === i ? 1 : .35) : .45;
    glow(ctx, cx + Math.cos(a) * 36, cy + Math.sin(a) * 36, 3, [255, 196, 110], on);
  }
}

function glow(ctx, x, y, radius, [r, g, b], strength) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, `rgba(${r},${g},${b},${Math.min(1, strength).toFixed(3)})`);
  gradient.addColorStop(.35, `rgba(${r},${g},${b},${(Math.min(1, strength) * .35).toFixed(3)})`);
  gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
}

function helicopterAt(sim) {
  const [x0, y0, x1, y1] = EXTRACTION.rect;
  const cx = (x0 + x1 + 1) / 2 * TILE, cy = (y0 + y1 + 1) / 2 * TILE;
  const arrive = sim.player.data ? Math.min(1, (sim.t - (sim.mission.breachAt || sim.t)) / 6) : 0;
  return { x: cx + (1 - arrive) * 220, y: cy - (1 - arrive) * 120, cx, cy, arrive };
}

function drawHelicopter(ctx, sim, time) {
  if (!sim.player.data) return;
  const { x, y, arrive } = helicopterAt(sim);
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(4,6,10,.4)'; ctx.beginPath(); ctx.ellipse(6 + (1 - arrive) * 10, 10 + (1 - arrive) * 14, 17, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3f4b45'; ctx.fillRect(-28, -1.5, 19, 3); ctx.fillRect(-30, -5.5, 3, 11);
  ctx.fillStyle = '#56645c'; ctx.beginPath(); ctx.ellipse(0, 0, 12.5, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#6b7b72'; ctx.beginPath(); ctx.ellipse(-1, -2, 9, 3.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#86b9cc'; ctx.beginPath(); ctx.ellipse(6.4, 0, 4.6, 4.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.ellipse(7.4, -1.4, 1.6, 1.1, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#2c3330'; ctx.lineWidth = .8; ctx.beginPath(); ctx.moveTo(-8, 7.5); ctx.lineTo(8, 7.5); ctx.moveTo(-8, -7.5); ctx.lineTo(8, -7.5); ctx.stroke();
  // The rotor is a blur with two blades catching the light.
  ctx.fillStyle = 'rgba(190,200,205,.12)'; ctx.beginPath(); ctx.arc(0, 0, 23, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(210,218,222,.5)'; ctx.lineWidth = 1.3;
  const spin = time * 22;
  ctx.beginPath();
  for (let i = 0; i < 2; i++) { const a = spin + i * Math.PI / 2; ctx.moveTo(Math.cos(a) * -22, Math.sin(a) * -22); ctx.lineTo(Math.cos(a) * 22, Math.sin(a) * 22); }
  ctx.stroke();
  ctx.restore();
}

/* ── main draw ─────────────────────────────────────────────────────────── */

export function camera(sim, view, dt) {
  const p = sim.player;
  // With a cursor the view leans toward it (`view.lean`, set by the client); without one it looks along the facing.
  const lookX = view.lean ? view.lean.x : Math.cos(p.facing) * (p.moving ? 26 : 10);
  const lookY = view.lean ? view.lean.y : Math.sin(p.facing) * (p.moving ? 18 : 8);
  const vw = view.w || VIEW_W, vh = view.h || VIEW_H;
  const targetX = Math.max(0, Math.min(WORLD_W - vw, p.x + lookX - vw / 2));
  const targetY = Math.max(0, Math.min(WORLD_H - vh, p.y + lookY - vh / 2));
  const k = view.snap ? 1 : 1 - Math.pow(.0012, dt);
  view.x += (targetX - view.x) * k; view.y += (targetY - view.y) * k;
  view.snap = false;
}

// Flashlight colour by what the guard is doing: warm on patrol, amber when curious, red on contact.
const BEAM = {
  patrol: [255, 236, 198], returning: [214, 228, 255], suspicious: [255, 214, 150], investigate: [255, 214, 150],
  search: [255, 190, 160], lockdown: [212, 196, 255], alert: [255, 150, 128],
};

export function drawWorld(ctx, sim, view, opts = {}) {
  const time = sim.t, cam = view, reduce = Boolean(opts.reduceMotion);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#07080a'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  const vw = view.w || VIEW_W, vh = view.h || VIEW_H, scale = view.scale || SCALE;
  const sx = Math.round(Math.max(0, Math.min(WORLD_W - vw, cam.x + (opts.shake?.x || 0))) * scale) / scale;
  const sy = Math.round(Math.max(0, Math.min(WORLD_H - vh, cam.y + (opts.shake?.y || 0))) * scale) / scale;
  const frame = { sx, sy, vw, vh };
  ctx.setTransform(scale, 0, 0, scale, -sx * scale, -sy * scale);
  const onScreen = (x, y, pad = 140) => x > sx - pad && x < sx + vw + pad && y > sy - pad && y < sy + vh + pad;

  // ── The scene, painted at full light.
  const floor = staticLayer(scale);
  ctx.drawImage(floor, 0, 0, floor.width, floor.height, 0, 0, WORLD_W, WORLD_H);
  drawDoors(ctx, sim);
  drawProps(ctx, sim, time);
  drawBlood(ctx, sim);
  for (const g of sim.guards) if (g.down && !g.hidden && !g.carried && onScreen(g.x, g.y, 20)) drawGuard(ctx, g, time, false);
  for (const mote of sim.dust || []) {
    const k = mote.age / mote.life;
    ctx.fillStyle = `rgba(176,168,150,${(.4 * (1 - k)).toFixed(3)})`;
    ctx.beginPath(); ctx.arc(mote.x, mote.y, mote.r * (1 + k * 1.3), 0, Math.PI * 2); ctx.fill();
  }
  for (const g of sim.guards) if (!g.down && onScreen(g.x, g.y, 20)) drawGuard(ctx, g, time, opts.selected === g.id, g.grabbed ? heldGuardPose(sim, g, time) : null);
  for (const g of sim.guards) if (g.carried) drawGuard(ctx, g, time, false);
  drawOperative(ctx, sim, time, opts);
  drawGrass(ctx, sim, time, frame, reduce);
  drawCanopies(ctx, time, frame, reduce);
  drawHelicopter(ctx, sim, time);

  // ── Light: lamps baked, plus flashlights, camera beams, screens, the muzzle and the alarm.
  const sources = [], cones = [];
  for (const g of sim.guards) {
    if (g.down || g.grabbed || !onScreen(g.x, g.y)) continue;
    const range = sim.rules.range * TILE * (g.groggy > 0 ? .7 : 1);
    const points = conePolygon(sim, g.x, g.y, g.facing, sim.rules.fov / 2, range);
    const state = g.sees ? 'alert' : g.state;
    cones.push({ g, points, color: STATE_COLORS[state] || STATE_COLORS.patrol, alert: g.sees });
    sources.push({ points, x: g.x, y: g.y, range, color: BEAM[state] || BEAM.patrol, strength: (g.sees ? .95 : .8) * (g.groggy > 0 ? .7 : 1) });
    // Spill from the flashlight, so the guard holding it is never a black hole.
    sources.push({ x: g.x, y: g.y, radius: 13, color: [255, 226, 186], strength: .24 });
  }
  for (const camera of sim.cameras) {
    if (!camera.on || !onScreen(camera.x, camera.y)) continue;
    const hot = camera.track > 0 || camera.meter > .5;
    const points = conePolygon(sim, camera.x, camera.y, camera.angle, .52, camera.range, 18);
    cones.push({ g: camera, points, color: hot ? '#f0705e' : '#a5bfdc', alert: hot, camera: true });
    sources.push({ points, x: camera.x, y: camera.y, range: camera.range, color: hot ? [255, 110, 90] : [150, 190, 255], strength: .3 + camera.meter * .25 });
  }
  for (const f of FIXTURES) {
    if (!onScreen(f.x, f.y, 20)) continue;
    sources.push({ x: f.x + f.w / 2, y: f.y + f.h / 2, radius: f.kind === 'screen' ? 15 : 11, color: f.objective && sim.player.data ? [255, 96, 76] : f.color, strength: f.kind === 'screen' ? .32 : .2 });
  }
  const p = sim.player;
  // A little moonlight on the operative: in the dark they read as a shape, not a hole.
  if (!p.locker) sources.push({ x: p.x, y: p.y, radius: 18, color: [70, 86, 120], strength: .4 });
  const flash = time - (p.shotAt ?? -99);
  if (flash < .08) sources.push({ x: p.x + Math.cos(p.facing) * 8, y: p.y + Math.sin(p.facing) * 8, radius: 76, color: [255, 214, 150], strength: 1.3 * (1 - flash / .08) });
  for (const tracer of sim.tracers) if (tracer.age < .1) sources.push({ x: tracer.x1, y: tracer.y1, radius: 14, color: [255, 200, 140], strength: .7 * (1 - tracer.age / .1) });
  if (p.data) {
    const heli = helicopterAt(sim), sweep = reduce ? 0 : Math.sin(time * .9) * 14;
    sources.push({ x: heli.x + sweep, y: heli.y + 18, radius: 34, color: [235, 245, 255], strength: .5 * heli.arrive + .2 });
  }
  const alarm = sim.net.phase === 'alert' ? 1 : sim.net.phase === 'search' ? .35 : 0;
  applyLight(ctx, frame, sources, { time, alarm, reduceMotion: reduce });

  // ── What gives off its own light. A flashlight beam is a shaft of lit air, not only a lit floor.
  ctx.globalCompositeOperation = 'lighter';
  for (const cone of cones) {
    if (cone.camera) continue;
    const g = cone.g, reach = sim.rules.range * TILE * .9, [r, gg, b] = BEAM[g.sees ? 'alert' : g.state] || BEAM.patrol;
    const haze = ctx.createRadialGradient(g.x, g.y, 4, g.x, g.y, reach);
    haze.addColorStop(0, `rgba(${r},${gg},${b},.11)`); haze.addColorStop(.5, `rgba(${r},${gg},${b},.04)`); haze.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    ctx.fillStyle = haze;
    ctx.beginPath(); ctx.moveTo(cone.points[0][0], cone.points[0][1]);
    for (let i = 1; i < cone.points.length; i++) ctx.lineTo(cone.points[i][0], cone.points[i][1]);
    ctx.closePath(); ctx.fill();
  }
  drawLampGlows(ctx, time, frame, reduce);
  drawFixtures(ctx, time, frame, { breached: p.data, reduceMotion: reduce });
  drawLittleLights(ctx, sim, time, onScreen);
  drawOperativeGlow(ctx, sim, time, opts);
  ctx.globalCompositeOperation = 'source-over';

  // ── Readable on top: where each beam ends, sounds, shots, orders and marks.
  for (const cone of cones) {
    ctx.beginPath(); ctx.moveTo(cone.points[0][0], cone.points[0][1]);
    for (let i = 1; i < cone.points.length; i++) ctx.lineTo(cone.points[i][0], cone.points[i][1]);
    ctx.closePath();
    if (cone.alert) { ctx.fillStyle = hexAlpha('#f0705e', .1); ctx.fill(); }
    ctx.strokeStyle = hexAlpha(cone.color, cone.alert ? .5 : .24); ctx.lineWidth = .6; ctx.stroke();
    if (!cone.camera) { ctx.strokeStyle = hexAlpha(cone.color, .07); ctx.beginPath(); ctx.arc(cone.g.x, cone.g.y, sim.rules.peripheral * TILE, 0, Math.PI * 2); ctx.stroke(); }
  }
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
  drawCombat(ctx, sim);
  drawOrders(ctx, sim, time);
  if (p.locker) {
    ctx.strokeStyle = `rgba(236,201,129,${.5 + .3 * Math.sin(time * 4)})`; ctx.lineWidth = .8;
    ctx.strokeRect(toTile(p.x) * TILE + 1.5, toTile(p.y) * TILE + 1.5, TILE - 3, TILE - 3);
  }
  if (p.action && p.action.kind !== 'swing' && p.action.kind !== 'kill') {
    const a = p.action, k = Math.min(1, a.t / a.need);
    ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y - 12, 4, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#ecc981'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(p.x, p.y - 12, 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); ctx.stroke();
  }
  drawAtmosphere(ctx, time, frame, reduce);
  if (opts.intel) drawIntel(ctx, sim, opts);
  for (const g of sim.guards) if (!g.down && onScreen(g.x, g.y, 20)) drawIndicator(ctx, g, time);
  if (opts.target) { const g = sim.guards.find(item => item.id === opts.target); if (g) drawTargetMark(ctx, g, time); }
  if (opts.aim && opts.aiming) drawAim(ctx, sim, opts.aim, opts.aimHold);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawGrain(ctx, ctx.canvas.width, ctx.canvas.height, time, reduce);
  drawEdges(ctx, sim, cam, scale, view.ui || 1);
  drawScanner(ctx, sim, opts, view.ui || 1);
}

const ORDER_TAGS = { pursue: 'chase', intercept: 'cut off', block: 'hold', guard: 'guard', search: 'sweep', probe: 'check', investigate: 'check', panel: 'cameras' };

/** Jev's orders, drawn for a moment as a guard receives one: where it sent him, and for what. */
function drawOrders(ctx, sim, time) {
  for (const g of sim.guards) {
    const order = g.order;
    if (!order || g.down || g.sees) continue;
    const age = time - order.at;
    if (age < 0 || age > 2.6) continue;
    const fade = Math.min(1, age * 6) * Math.min(1, (2.6 - age) / .8);
    if (Math.hypot(order.x - g.x, order.y - g.y) < 10) continue;
    // The line runs out from the guard over a quarter second, so it reads as an order being given.
    const k = Math.min(1, age / .25), ex = g.x + (order.x - g.x) * k, ey = g.y + (order.y - g.y) * k;
    ctx.strokeStyle = `rgba(193,174,213,${.55 * fade})`; ctx.lineWidth = .8; ctx.setLineDash([4, 3]); ctx.lineDashOffset = -time * 14;
    ctx.beginPath(); ctx.moveTo(g.x, g.y); ctx.lineTo(ex, ey); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
    if (k < 1) continue;
    const r = 4 + Math.sin(time * 6) * .5;
    ctx.strokeStyle = `rgba(193,174,213,${.85 * fade})`; ctx.lineWidth = 1;
    ctx.beginPath();
    if (['block', 'guard', 'intercept'].includes(order.role)) { ctx.moveTo(order.x, order.y - r); ctx.lineTo(order.x + r, order.y); ctx.lineTo(order.x, order.y + r); ctx.lineTo(order.x - r, order.y); ctx.closePath(); }
    else ctx.arc(order.x, order.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = fade;
    label(ctx, `${g.name.toLowerCase()} · ${ORDER_TAGS[order.role] || order.role}`, order.x, order.y - 9, '#c1aed5');
    ctx.globalAlpha = 1;
  }
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
function drawEdges(ctx, sim, cam, scale = SCALE, ui = 1) {
  const w = ctx.canvas.width, h = ctx.canvas.height, m = 18 * ui;
  for (const g of sim.guards) {
    if (g.down || (!g.sees && g.meter < .15)) continue;
    const sx = (g.x - cam.x) * scale, sy = (g.y - cam.y) * scale;
    if (sx > 0 && sx < w && sy > 0 && sy < h) continue;
    const cx = Math.max(m, Math.min(w - m, sx)), cy = Math.max(m, Math.min(h - m, sy));
    const angle = Math.atan2(sy - h / 2, sx - w / 2);
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.scale(ui, ui);
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

function drawScanner(ctx, sim, opts, ui = 1) {
  const compact = Boolean(opts.compact), jammed = Boolean(opts.jammed);
  const w = jammed ? (compact ? 96 : 120) : compact ? 132 : 176;
  const h = jammed ? (compact ? 28 : 30) : compact ? 94 : 124;
  const x0 = ctx.canvas.width / ui - w - (compact ? 8 : 14), y0 = compact ? 8 : 14;
  const p = sim.player, cell = compact ? 3.9 : 5.2, span = 16;
  ctx.save();
  ctx.setTransform(ui, 0, 0, ui, 0, 0);
  ctx.fillStyle = 'rgba(6,10,9,.78)'; ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = 'rgba(173,191,156,.45)'; ctx.lineWidth = 1; ctx.strokeRect(x0 + .5, y0 + .5, w - 1, h - 1);
  ctx.beginPath(); ctx.rect(x0 + 1, y0 + 1, w - 2, h - 2); ctx.clip();
  if (jammed) {
    for (let i = 0; i < (compact ? 90 : 260); i++) {
      ctx.fillStyle = `rgba(173,191,156,${Math.random() * .35})`;
      ctx.fillRect(x0 + Math.random() * w, y0 + Math.random() * h, 2, 1);
    }
    ctx.fillStyle = '#f0705e'; ctx.font = `bold ${compact ? 9 : 13}px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
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
