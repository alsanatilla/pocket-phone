// pip as a low-poly PlayStation character: a little handheld console with a glass face, stubby limbs and a glowing antenna.
import { slab, ball, tube, chain, translate, scale, rotX, rotY, rotZ, render, ps1Quantize, makeTarget, camera, texture } from './raster.mjs';
import { propMaterials, propParts } from './props.mjs';

export const ACCENT = [0xf9 / 255, 0xf5 / 255, 0x94 / 255];
const mix = (a, b, k) => a.map((x, i) => x + (b[i] - x) * k);

// ── The face: a 32×36 texture, hand-placed like a PS1 texture page. Eyes and mouth glow and ignore the lights. ──
function faceTexture(accent, expr = 'open', look = [0, 0]) {
  const W = 32, H = 36, g = Array.from({ length: H }, () => Array(W).fill('.'));
  const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = c; };
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, c); };
  // bezel and glass with a one-pixel corner cut
  rect(3, 2, 26, 20, 'b'); for (const [x, y] of [[3, 2], [28, 2], [3, 21], [28, 21]]) set(x, y, '.');
  rect(4, 3, 24, 18, 's'); for (const [x, y] of [[4, 3], [27, 3], [4, 20], [27, 20]]) set(x, y, 'b');
  for (let y = 4; y < 20; y += 2) for (let x = 5; x < 27; x++) if (g[y][x] === 's') set(x, y, 'S');
  for (const [x, y] of [[6, 5], [7, 5], [8, 5], [6, 6]]) set(x, y, 'r'); // reflection on the glass
  const [lx, ly] = look;
  for (const cx of [11, 20]) {
    const x = cx + lx, y = 9 + ly;
    if (expr === 'blink') rect(x - 1, y + 2, 4, 1, 'e');
    else if (expr === 'happy') { set(x - 1, y + 3, 'e'); set(x, y + 2, 'e'); set(x + 1, y + 1, 'E'); set(x + 2, y + 2, 'e'); set(x + 3, y + 3, 'e'); }
    else if (expr === 'wide') { rect(x - 1, y - 1, 4, 7, 'e'); rect(x, y, 2, 4, 'E'); }
    else { rect(x, y, 3, 5, 'e'); rect(x + 1, y + 1, 1, 3, 'E'); }
  }
  if (expr === 'happy' || expr === 'open') { set(14, 16, 'e'); rect(15, 17, 3, 1, 'e'); set(18, 16, 'e'); }
  else if (expr === 'wide') rect(15, 16, 2, 2, 'e');
  else rect(15, 17, 3, 1, 'e');
  // controls: d-pad, speaker slits, two buttons
  rect(8, 25, 3, 9, 'k'); rect(5, 28, 9, 3, 'k'); set(8, 25, 'K'); set(9, 25, 'K'); set(5, 28, 'K'); set(9, 29, 'K');
  for (const x of [15, 17, 19]) rect(x, 26, 1, 6, 'g');
  for (const [cx, cy, c, hi] of [[25, 31, 'o', 'O'], [28, 26, 'w', 'W']]) { rect(cx - 1, cy - 2, 3, 5, c); rect(cx - 2, cy - 1, 5, 3, c); set(cx - 1, cy - 1, hi); }
  const dark = [.09, .1, .12];
  return texture(g.map(r => r.join('')), {
    '.': [...accent, 1], b: [...dark, 1], s: [.03, .06, .07, 1], S: [.06, .1, .11, 1], r: [.2, .28, .3, 1],
    e: [...mix(accent, [1, 1, 1], .25), 1, 1], E: [1, 1, .96, 1, 1],
    k: [.1, .1, .12, 1], K: [.38, .38, .42, 1], g: [...accent.map(c => c * .45), 1],
    o: [1, .55, .2, 1], O: [1, .85, .6, 1], w: [.86, .87, .9, 1], W: [1, 1, 1, 1],
  });
}

/** The back: a battery cover with screws and a white label, as on a real handheld. */
function backTexture(accent) {
  const W = 32, H = 36, g = Array.from({ length: H }, () => Array(W).fill('.'));
  const rect = (x, y, w, h, c) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (g[y + j]) g[y + j][x + i] = c; };
  rect(6, 18, 20, 13, 'd'); rect(7, 19, 18, 11, 'c'); for (let y = 21; y < 29; y += 2) rect(9, y, 14, 1, 'd');
  rect(8, 4, 16, 9, 'w'); rect(9, 5, 14, 2, 'a'); rect(9, 8, 10, 1, 'g'); rect(9, 10, 7, 1, 'g');
  for (const [x, y] of [[3, 3], [28, 3], [3, 32], [28, 32]]) { rect(x - 1, y - 1, 3, 3, 'd'); g[y][x] = 's'; }
  return texture(g.map(row => row.join('')), { '.': [...accent, 1], d: [...accent.map(c => c * .55), 1], c: [...accent.map(c => c * .78), 1], w: [.9, .9, .88, 1], a: [...accent.map(c => c * .7), 1], g: [.55, .55, .55, 1], s: [.2, .2, .22, 1] });
}

// ── Meshes, built once ──
export const BODY = slab(1, 1.12, .62, .2, 'shell', { frontMat: 'face', backMat: 'back' });
export const STEM = tube(.035, .03, .56, .8, 'limb', { sides: 5 });
export const BULB = ball(.085, .085, .085, 'glow', { slices: 6, stacks: 4 });
const ARM = tube(.075, .065, -.34, 0, 'limb', { sides: 6 });
const HAND = ball(.12, .12, .12, 'hand', { slices: 7, stacks: 5 });
const LEG = tube(.085, .08, -.2, 0, 'limb', { sides: 6 });
const FOOT = ball(.17, .1, .21, 'shoe', { slices: 8, stacks: 5 });
const STAGE = tube(.66, .7, -.06, 0, 'stage', { sides: 12 });
export const FLOOR = -.9;

export function materials(accent = ACCENT, face = {}, prop = {}) {
  return {
    ...propMaterials(accent, prop),
    shell: { id: 1, color: accent },
    face: { id: 2, color: [1, 1, 1], tex: faceTexture(accent, face.expr, face.look) },
    back: { id: 8, color: [1, 1, 1], tex: backTexture(accent) },
    limb: { id: 3, color: [.3, .32, .37] },
    hand: { id: 4, color: [.92, .92, .9] },
    shoe: { id: 5, color: mix(accent, [0, 0, 0], .35) },
    glow: { id: 6, color: mix(accent, [1, 1, 1], .4), emissive: .75 },
    stage: { id: 7, color: [.13, .14, .17] },
  };
}
export const LIGHTS = {
  ambient: [.3, .29, .36],
  dirs: [
    { dir: [-.6, .8, .9], color: [.95, .9, .78] },   // warm key, top left
    { dir: [.9, .05, .45], color: [.2, .26, .45] },  // cool fill
    { dir: [.5, .45, -1], color: [.55, .6, .9] },    // rim from behind, so dark limbs read against black
  ],
};

/** A pose: root {y, sx, sy, turn, tilt, lean}, arms {l:[swing, out], r:[...]}, legs {l, r}, antenna wobble, face. */
export function pipParts(p) {
  const { root = {}, arms = {}, legs = {}, antenna = 0 } = p;
  const y = root.y || 0, sx = root.sx || 1, sy = root.sy || 1;
  const R = chain(translate(root.x || 0, FLOOR + y, root.z || 0), rotY(root.turn || 0), rotZ(root.tilt || 0), rotX(root.lean || 0), scale(sx, sy, sx), translate(0, -FLOOR, 0));
  const parts = [{ mesh: BODY, matrix: R }];
  const stemM = chain(R, translate(0, .56, 0), rotX(antenna), rotZ(antenna * .5), translate(0, -.56, 0));
  parts.push({ mesh: STEM, matrix: stemM }, { mesh: BULB, matrix: chain(stemM, translate(0, .86, 0)) });
  for (const [side, sign] of [['l', -1], ['r', 1]]) {
    const [swing = 0, out = .25] = arms[side] || [];
    const A = chain(R, translate(sign * .52, .04, .1), rotZ(sign * out), rotX(swing));
    parts.push({ mesh: ARM, matrix: A }, { mesh: HAND, matrix: chain(A, translate(0, -.42, 0)) });
    const L = chain(R, translate(sign * .25, -.55, 0), rotX(legs[side] || 0));
    parts.push({ mesh: LEG, matrix: L }, { mesh: FOOT, matrix: chain(L, translate(0, -.26, .06)) });
  }
  parts.push(...propParts(p.prop, R));
  return parts;
}

export const CAMERA = camera({ eye: [.5, .62, 4.35], at: [0, .12, 0], fov: .66 });
/** Renders one pose to RGBA at the PlayStation's chunky resolution. */
export function renderPip(pose, { size = 96, accent = ACCENT, stage = true, snap = true } = {}) {
  const target = makeTarget(size, size), mats = materials(accent, pose.face || {}, pose.prop || {});
  const parts = pipParts(pose).map(part => ({ ...part, matrix: chain(rotY(-.32), part.matrix) }));
  if (stage) parts.unshift({ mesh: STAGE, matrix: chain(rotY(-.32), translate(0, FLOOR - .02, 0)) });
  render(target, parts, { camera: CAMERA, materials: mats, lights: LIGHTS, snap, fog: { near: 4.4, far: 7.5, color: [0, 0, 0] } });
  return ps1Quantize(target);
}

// ── Animation: poses at keyframes, eased in between ──
const ease = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => typeof a === 'number' ? a + (b - a) * t : Array.isArray(a) ? a.map((x, i) => lerp(x, b[i], t)) : Object.fromEntries(Object.keys({ ...a, ...b }).map(k => [k, a[k] === undefined ? b[k] : b[k] === undefined ? a[k] : typeof a[k] === 'string' ? (t < .5 ? a[k] : b[k]) : lerp(a[k], b[k], t)]));
const IDLE = { root: { x: 0, z: 0, y: 0, sx: 1, sy: 1, turn: 0, tilt: 0, lean: 0 }, arms: { l: [-.15, .38], r: [-.15, .38] }, legs: { l: 0, r: 0 }, antenna: 0 };
const pose = over => {
  const p = JSON.parse(JSON.stringify(IDLE));
  for (const [k, v] of Object.entries(over)) p[k] = typeof v === 'object' && !Array.isArray(v) && k !== 'face' ? { ...p[k], ...v } : v;
  return p;
};
/** Samples keyed poses [{at, pose}] over n frames; faces switch on the nearest key, like a texture swap. */
export function animate(keys, n) {
  return [...Array(n)].map((_, i) => {
    const t = i / n; let k = 0; while (k < keys.length - 2 && keys[k + 1].at <= t) k++;
    const a = keys[k], b = keys[k + 1], u = Math.min(1, Math.max(0, (t - a.at) / ((b.at - a.at) || 1)));
    const p = lerp(a.pose, b.pose, a.linear ? u : ease(u));
    p.face = (u < .5 ? a : b).pose.face || { expr: 'open' };
    if (p.prop && (a.pose.prop || b.pose.prop)) p.prop = { ...(u < .5 ? a : b).pose.prop, ...p.prop, kind: (a.pose.prop || b.pose.prop).kind };
    return p;
  });
}

export const HOP = animate([
  { at: 0, pose: pose({ face: { expr: 'open' } }) },
  { at: .12, pose: pose({ root: { sy: .82, sx: 1.12 }, arms: { l: [.6, .5], r: [.6, .5] }, legs: { l: .15, r: .15 }, antenna: -.25, face: { expr: 'wide' } }) },
  { at: .25, pose: pose({ root: { y: .28, sy: 1.16, sx: .9 }, arms: { l: [-.4, 2.3], r: [-.4, 2.3] }, legs: { l: .3, r: .3 }, antenna: .45, face: { expr: 'happy' } }), linear: true },
  { at: .4, pose: pose({ root: { y: .5, sy: 1.02, sx: .98, lean: -.08 }, arms: { l: [0, 2.6], r: [0, 2.6] }, legs: { l: -.55, r: -.55 }, antenna: .2, face: { expr: 'happy' } }) },
  { at: .55, pose: pose({ root: { y: .42, sy: 1.04, lean: .06 }, arms: { l: [0, 1.6], r: [0, 1.6] }, legs: { l: -.3, r: -.3 }, antenna: -.35, face: { expr: 'happy' } }) },
  { at: .68, pose: pose({ root: { y: 0, sy: .76, sx: 1.18 }, arms: { l: [.3, .9], r: [.3, .9] }, legs: { l: 0, r: 0 }, antenna: .5, face: { expr: 'blink' } }), linear: true },
  { at: .8, pose: pose({ root: { sy: 1.07, sx: .95 }, arms: { l: [0, .35], r: [0, .35] }, antenna: -.25, face: { expr: 'open' } }) },
  { at: .9, pose: pose({ root: { sy: .97, sx: 1.02 }, antenna: .1, face: { expr: 'open' } }) },
  { at: 1, pose: pose({ face: { expr: 'open' } }) },
], 12);

export const WAVE = animate([
  { at: 0, pose: pose({ root: { tilt: .04 }, arms: { r: [0, 2.35] }, antenna: -.1, face: { expr: 'open', look: [1, 0] } }) },
  { at: .25, pose: pose({ root: { tilt: -.05, turn: .1 }, arms: { r: [-.2, 2.85], l: [.15, .3] }, antenna: .2, face: { expr: 'happy' } }) },
  { at: .5, pose: pose({ root: { tilt: .05, y: .02 }, arms: { r: [0, 2.3], l: [-.1, .3] }, antenna: -.2, face: { expr: 'happy' } }) },
  { at: .72, pose: pose({ root: { tilt: -.04, turn: .1 }, arms: { r: [-.2, 2.85] }, antenna: .18, face: { expr: 'blink' } }) },
  { at: .8, pose: pose({ root: { tilt: -.02, turn: .08 }, arms: { r: [-.15, 2.7] }, antenna: .1, face: { expr: 'open', look: [1, 0] } }) },
  { at: 1, pose: pose({ root: { tilt: .04 }, arms: { r: [0, 2.35] }, antenna: -.1, face: { expr: 'open', look: [1, 0] } }) },
], 12);

// ── The rest of pip's day: written frame by frame where a cycle is simpler than keys ──
const fixLook = p => { if (p.face?.look) p.face.look = p.face.look.map(Math.round); return p; };
export const WALK = [...Array(16)].map((_, i) => {
  const right = i < 8, k = i % 8, turning = k === 7, step = Math.sin(i * Math.PI / 2), x = right ? -.32 + k / 6 * .64 : .32 - k / 6 * .64;
  return fixLook(pose({ root: { x: turning ? (right ? .32 : -.32) : x, y: Math.abs(Math.cos(i * Math.PI / 2)) * .05, turn: turning ? 0 : right ? .9 : -.42, tilt: step * .03 },
    arms: { l: [turning ? 0 : -step * .55, .3], r: [turning ? 0 : step * .55, .3] }, legs: { l: turning ? 0 : step * .55, r: turning ? 0 : -step * .55 }, antenna: -step * .15,
    face: { expr: turning ? 'blink' : 'open', look: [turning ? 0 : right ? 1 : -1, 0] } }));
});
export const JUGGLE = [...Array(12)].map((_, i) => {
  const phase = i / 12, a = phase * Math.PI * 2, catchL = Math.sin(a * 3) > 0;
  return fixLook(pose({ root: { y: catchL ? .02 : 0, tilt: Math.sin(a * 3) * .03 }, arms: { l: [-.3, catchL ? 2.25 : 1.95], r: [-.3, catchL ? 1.95 : 2.25] }, antenna: Math.sin(a * 3) * .2,
    face: { expr: i === 9 ? 'blink' : 'open', look: [Math.cos(a) * 1.4, -2] }, prop: { kind: 'juggle', phase } }));
});
export const READ = [...Array(12)].map((_, i) => {
  const flip = i >= 8 ? (i - 7) / 4 : 0, line = i < 8 ? Math.floor(i / 2.67) : -1;
  return fixLook(pose({ root: { lean: .12, y: i === 4 ? .015 : 0 }, arms: { l: [-1.15, .32], r: [-1.15, .32] }, antenna: Math.sin(i / 12 * Math.PI * 2) * .08,
    face: { expr: i === 6 ? 'blink' : 'open', look: [i < 8 ? -1 + (i % 3) : 0, 2] }, prop: { kind: 'book', line, flip } }));
});
export const WRITE = [...Array(12)].map((_, i) => {
  const progress = (i + 1) / 12, row = Math.min(2, Math.floor(progress * 3 - .001)), pen = (progress * 3) % 1 || 1;
  return fixLook(pose({ root: { lean: .14, tilt: Math.sin(i * 1.3) * .02 }, arms: { l: [-1.05, .2], r: [-1.2 + pen * .15, .1 + pen * .35] }, antenna: Math.sin(i * 1.3) * .1,
    face: { expr: i === 10 ? 'blink' : 'open', look: [Math.round(-1 + pen * 2), 2] }, prop: { kind: 'pad', progress, pen, row } }));
});
export const PULL = [0, 1, 2, 3].map(i => pose({ root: { sy: 1 - i * .075, sx: 1 + i * .05 }, arms: { l: [.3 * i, .4 + i * .25], r: [.3 * i, .4 + i * .25] }, legs: { l: .1 * i, r: .1 * i }, antenna: -.12 * i,
  face: { expr: i >= 2 ? 'wide' : 'open' } }));
/** Activities in the order the apps use. */
export const ANIMATIONS = { wave: WAVE, walk: WALK, juggle: JUGGLE, read: READ, hop: HOP, write: WRITE, pull: PULL };
export const STEP_MS = { wave: 95, walk: 85, juggle: 80, read: 110, hop: 85, write: 100, pull: 90 };
