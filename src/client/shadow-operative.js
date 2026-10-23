// Purely visual operative rig. Local +X is forward; all measurements are world pixels.
// The same pose drives the lit and additive passes so goggles/weapons never detach.
const TAU = Math.PI * 2;
const clamp = x => Math.max(0, Math.min(1, x));
const ease = x => { x = clamp(x); return x * x * (3 - 2 * x); };
const rigMemory = new WeakMap();
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function pose(sim, reduceMotion) {
  const p = sim.player, t = sim.t, m = p.move, a = p.action;
  let memory = rigMemory.get(p);
  if (!memory || t < memory.t) { memory = { t, facing: p.facing, turn: 0, aim: 0 }; rigMemory.set(p, memory); }
  const dt = Math.min(.05, Math.max(0, t - memory.t));
  if (dt) {
    const k = 1 - Math.exp(-dt * 19);
    memory.turn += (Math.max(-.35, Math.min(.35, wrap(p.facing - memory.facing) / dt * .035)) - memory.turn) * k;
    memory.aim += ((p.aiming || t - p.shotAt < .32 ? 1 : 0) - memory.aim) * k;
    memory.t = t; memory.facing = p.facing;
  }
  const u = m ? clamp(m.t / m.time) : 0, v = a ? clamp(a.t / a.need) : 0;
  const run = p.running || p.speed > 140;
  const stride = p.moving && !m && !a ? Math.sin(p.anim * (run ? 22 : p.crouch ? 10 : 14)) : 0;
  const r = { x: 0, y: 0, angle: p.facing, sx: 1, sy: 1, head: 1.9, stride, aim: memory.aim,
    left: [2 - stride * 1.7, -4.1], right: [2 + stride * 1.7, 4.1], feet: [[-3 + stride * 2.5, -2.7], [-3 - stride * 2.5, 2.7]], blade: null, muzzle: null };
  const motion = reduceMotion ? .25 : 1;
  r.x = (run && p.moving ? 1 : 0) + Math.sin(p.anim * 3.2) * .16;
  r.y = memory.turn * 2 * motion; r.angle += memory.turn * motion;
  r.sy = 1 + Math.sin(p.anim * 3.2) * .025;
  if (p.crouch) { r.sx = .89; r.sy = 1.08; r.head = 1.3; r.feet = [[-2 + stride * 1.5, -3.5], [-2 - stride * 1.5, 3.5]]; }
  const settle = Math.max(0, 1 - (t - p.dashEndedAt) / .18);
  if (!m && settle) { r.sx -= .13 * Math.sin(settle * Math.PI) * motion; r.sy += .16 * Math.sin(settle * Math.PI) * motion; }
  if (m) {
    r.angle = m.angle;
    if (m.kind === 'dash') {
      const stretch = Math.sin(ease((u - .12) / .75) * Math.PI);
      r.sx = 1 + (.38 * stretch - .16 * (1 - ease(u / .18))) * motion;
      r.sy = 1 - .22 * stretch * motion;
      r.left = [-3, -4]; r.right = [-4, 3.5]; r.feet = [[-6, -2], [-3, 2.4]]; r.head = 2.6;
    } else if (m.kind === 'slide') {
      r.angle += .28 * motion; r.sx = 1.1; r.sy = .78;
      r.left = [-3.5, -4.5]; r.right = [3, 3]; r.feet = [[5.7, -2.5], [-2, 3.7]]; r.head = -.2;
    } else {
      const tuck = Math.sin(u * Math.PI);
      r.left = [4.5 - u * 6, -5]; r.right = [3, 3.6];
      r.feet = [[-3 + tuck * 3, -3.2], [-4 + tuck * 3, 3.2]];
      r.sx = 1 - .18 * tuck * motion; r.sy = 1 + .1 * tuck * motion;
    }
  }
  if (p.carrying != null) { r.left = [-5.5, -3]; r.right = [-5.5, 3]; r.head = .8; r.x -= .7; }
  if (r.aim > .01) {
    const kick = Math.exp(-Math.max(0, t - p.shotAt) * 29) * 1.8;
    const f = r.aim;
    r.left = [r.left[0] * (1 - f) + (5 - kick) * f, -4.1 * (1 - f) - .4 * f];
    r.right = [r.right[0] * (1 - f) + (5 - kick) * f, 4.1 * (1 - f) + 1.4 * f];
    r.muzzle = [9 - kick, 1.1]; r.x -= kick * .35;
  }
  if (a?.kind === 'swing' || a?.kind === 'kill') {
    const swing = a.kind === 'swing';
    const sweep = swing ? -1.45 + 2.8 * ease((v - .15) / .65) : -.25 + .55 * ease(v);
    const reach = swing ? 6 + Math.sin(v * Math.PI) * 1.6 : 3 + 5 * Math.sin(ease(v) * Math.PI);
    r.right = [1 + Math.cos(sweep) * reach, Math.sin(sweep) * reach];
    r.left = swing ? [1, -4.3] : [5.5, -2.7];
    r.blade = { x: r.right[0], y: r.right[1], angle: sweep, v, swing };
    r.angle += (swing ? -.22 + .45 * ease(v) : 0) * motion;
    r.x += Math.sin(v * Math.PI) * .8; r.muzzle = null;
  } else if (a?.kind === 'takedown') {
    const hold = ease(v / .35), drop = ease((v - .68) / .32);
    r.left = [5.8 - hold * 1.8 - drop, -3 + hold]; r.right = [6 - hold * 2, 3 - hold * 2];
    r.head = 1.1; r.x -= drop; r.sy *= 1 - .16 * drop * motion; r.muzzle = null;
  } else if (a?.kind === 'hack' || a?.kind === 'panel') {
    r.left = [5 + Math.sin(p.anim * 24) * .5, -2.4]; r.right = [5 + Math.cos(p.anim * 21) * .5, 2.4]; r.head = 2.5; r.muzzle = null;
  }
  return r;
}
function oval(ctx, x, y, rx, ry, color) {
  ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
}
function line(ctx, points, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(...points[0]);
  for (let i = 1; i < points.length; i++) ctx.lineTo(...points[i]); ctx.stroke();
}
function transform(ctx, p, r) {
  ctx.translate(p.x, p.y - (p.z || 0)); ctx.rotate(r.angle); ctx.translate(r.x, r.y); ctx.scale(r.sx, r.sy);
  ctx.globalAlpha *= p.hidden ? .55 : 1;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
}

export function drawOperative(ctx, sim, time, opts = {}) {
  const p = sim.player;
  if (p.locker) return;
  if (!opts.reduceMotion) for (const ghost of sim.trail || []) {
    const life = clamp(1 - ghost.age / .2);
    ctx.save(); ctx.globalAlpha *= life * .25; ctx.translate(ghost.x, ghost.y - (ghost.z || 0)); ctx.rotate(ghost.angle ?? ghost.facing);
    oval(ctx, -1.5, 0, 6.5, ghost.crouch ? 3 : 4, '#6ca5a0');
    line(ctx, [[-7, -2.8], [-2, -3], [3, 0]], '#b2d2b8', 1.2); ctx.restore();
  }
  const r = pose(sim, opts.reduceMotion);
  ctx.save(); oval(ctx, p.x + 1, p.y + 2, 6 - (p.z || 0) * .2, 4.4 - (p.z || 0) * .15, 'rgba(0,0,0,.35)'); ctx.restore();
  ctx.save(); transform(ctx, p, r);
  for (const foot of r.feet) {
    line(ctx, [[-1, foot[1] * .6], [foot[0] - .7, foot[1]]], '#263c40', 2.5);
    line(ctx, [[foot[0] - 1, foot[1]], [foot[0] + 1, foot[1]]], '#101e23', 2);
    line(ctx, [[foot[0], foot[1] - .5], [foot[0] + .8, foot[1] - .5]], '#718481', .6);
  }
  // Broad shoulder plates, separate elbows and gloves read even at 2x scale.
  for (const [side, hand] of [[-1, r.left], [1, r.right]]) {
    const elbow = [(hand[0] - 1) * .45, side * (4.2 + (p.crouch ? .4 : 0))];
    line(ctx, [[0, side * 2.7], elbow, hand], '#152a30', 2.6);
    line(ctx, [[0, side * 2.7], elbow], '#5d7d7d', 1.6);
    oval(ctx, hand[0], hand[1], 1.15, 1, '#bbc0ad');
    oval(ctx, hand[0] - .5, hand[1], .65, .9, '#253d40');
  }
  oval(ctx, -.5, 0, 4.1, 3.4, '#496b6c');
  oval(ctx, -2.6, 0, 1.6, 2.8, '#1b3038');
  line(ctx, [[-3.3, -1.8], [-3.3, 1.8]], '#7f9890', .6);
  line(ctx, [[-1.4, -2.7], [.6, 2.5]], '#172b30', 1.2);
  line(ctx, [[-1.5, -2.8], [-.2, -2.8]], '#ecc981', .8);
  ctx.fillStyle = '#263e42'; ctx.fillRect(-1.7, 1, 1.8, 1.4);
  // Hood, helmet rim and a two-lens NVG bridge.
  oval(ctx, r.head - .4, 0, 2.6, 2.55, '#17292e');
  oval(ctx, r.head - .5, -.35, 2, 1.9, '#587674');
  line(ctx, [[r.head - 1.3, -1.4], [r.head + .3, -1.5]], '#829990', .65);
  line(ctx, [[r.head + 1.6, -1.6], [r.head + 1.6, 1.6]], '#101c24', 1.4);
  for (const y of [-1, 1]) oval(ctx, r.head + 2, y, .7, .55, '#a4df99');
  if (r.blade) {
    const b = r.blade;
    if (!opts.reduceMotion && b.swing && b.v > .18 && b.v < .88) {
      ctx.save(); ctx.globalAlpha *= Math.sin(b.v * Math.PI) * .42;
      ctx.strokeStyle = '#f0e9dd'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(1, 0, 10, b.angle - .85, b.angle); ctx.stroke();
      ctx.globalAlpha *= .4; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.arc(1, 0, 8.6, b.angle - 1.05, b.angle); ctx.stroke(); ctx.restore();
    }
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.angle);
    line(ctx, [[-.6, 0], [1, 0]], '#ecc981', 1.1);
    ctx.fillStyle = '#f0e9dd'; ctx.beginPath(); ctx.moveTo(1, -.55); ctx.lineTo(4.8, 0); ctx.lineTo(1, .65); ctx.fill(); ctx.restore();
  } else if (r.muzzle) {
    ctx.save(); ctx.translate(r.muzzle[0], r.muzzle[1]); ctx.rotate((1 - r.aim) * .8);
    line(ctx, [[-4, 0], [0, 0]], '#111e26', 1.6); line(ctx, [[-3.5, -.5], [-.4, -.5]], '#a2aaa2', .65); ctx.restore();
  } else {
    line(ctx, [[-2, 2.9], [1, 3.4]], '#d3c6a5', .75);
  }
  // Slide grit is deterministic and needs neither particles nor gradients.
  if (p.move?.kind === 'slide' && !opts.reduceMotion) {
    ctx.save(); ctx.globalAlpha *= .35 * Math.sin(clamp(p.move.t / p.move.time) * Math.PI);
    for (let i = 0; i < 5; i++) { const f = (p.move.t * 4 + i / 5) % 1; oval(ctx, -4 - f * 10, (i % 2 ? -1 : 1) * (3 + f * 3), .5 + f, .4, '#c7bb98'); }
    ctx.restore();
  }
  ctx.restore();
}

export function drawOperativeGlow(ctx, sim, time, opts = {}) {
  const p = sim.player; if (p.locker) return;
  const r = pose(sim, opts.reduceMotion);
  ctx.save(); transform(ctx, p, r);
  for (const y of [-1, 1]) {
    oval(ctx, r.head + 2, y, 1.25, 1, 'rgba(109,218,128,.12)');
    oval(ctx, r.head + 2, y, .55, .45, '#91db8a');
  }
  const shotAge = sim.t - p.shotAt;
  if (r.muzzle && shotAge >= 0 && shotAge < .075) {
    const [x, y] = r.muzzle;
    const flash = 1 - shotAge / .075;
    ctx.globalAlpha *= flash;
    if (!opts.reduceMotion) {
      ctx.fillStyle = '#ecc981'; ctx.beginPath(); ctx.moveTo(x, y - 1.8); ctx.lineTo(x + 5, y); ctx.lineTo(x, y + 1.8); ctx.lineTo(x + 1, y); ctx.fill();
    }
    oval(ctx, x + .8, y, 1.3, .7, '#f0e9dd');
  }
  if (r.blade && r.blade.v > .35 && r.blade.v < .65) {
    const b = r.blade, x = b.x + Math.cos(b.angle) * 4, y = b.y + Math.sin(b.angle) * 4;
    line(ctx, [[x - .8, y], [x + .8, y]], '#ecc981', .5);
    if (!opts.reduceMotion) line(ctx, [[x, y - 1.3], [x, y + 1.3]], '#f0e9dd', .45);
  }
  ctx.restore();
}

export function heldGuardPose(sim, g, time) {
  const p = sim.player, a = p.action;
  if (!g.grabbed || a?.target !== g.id || !['kill', 'takedown'].includes(a.kind)) return null;
  const u = clamp(a.t / a.need), grab = ease(u / .35), drop = ease((u - .7) / .3);
  const choke = a.kind === 'takedown';
  const reach = choke ? 6.8 : 8;
  const struggle = Math.sin(u * Math.PI * 10) * Math.sin(u * Math.PI) * (choke ? .6 : .25);
  // Blend back to the physical position before release: no jump to the corpse sprite.
  const hold = grab * (1 - drop);
  return {
    dx: (p.x + Math.cos(p.facing) * reach - g.x) * hold - Math.sin(p.facing) * struggle,
    dy: (p.y + Math.sin(p.facing) * reach - g.y) * hold + Math.cos(p.facing) * struggle,
    angle: wrap(p.facing - g.facing) * hold + struggle * .12 + (choke ? .28 : .15) * drop,
    scale: 1 - .08 * Math.sin(u * Math.PI) - .18 * drop,
  };
}
