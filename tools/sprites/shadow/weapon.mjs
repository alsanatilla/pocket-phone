// The first-person Glock 18 viewmodel: a deterministic, low-poly pre-render in
// the same PS1 camera as the actors. Run: node tools/sprites/shadow/weapon.mjs
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { box, ball, slab, chain, translate, scale, rotX, rotY, rotZ, makeTarget, render, ps1Quantize, norm } from '../ps1/raster.mjs';
import { png } from '../ps1/apng.mjs';
import { spriteCamera } from './camera.mjs';

const ROOT = new URL('../../../', import.meta.url), W = 360, H = 340, COLS = 8;
const TAU = Math.PI * 2;
const clips = {
  idle: [6, 2.2], walk: [8, .72], sprint: [6, .52], aim: [3, 1.4],
  fire: [6, .3, false], reload: [10, 1.15, false], draw: [6, .5, false],
};

const GUN_LIGHTS = {
  ambient: [.54, .57, .62],
  dirs: [
    { dir: norm([-.45, .55, .75]), color: [1, .95, .86] },
    { dir: norm([.6, -.5, .35]), color: [.42, .46, .52] },
  ],
};
const cache = new Map();
function part(w, h, d, mat, at, M, round = false) {
  const key = [w, h, d, mat, round].join();
  if (!cache.has(key)) cache.set(key, round ? ball(w / 2, h / 2, d / 2, mat, { slices: 10, stacks: 6 }) : box(w, h, d, mat));
  return { mesh: cache.get(key), matrix: chain(M, translate(...at)) };
}
function rounded(w, h, d, r, mat, at, M) {
  const key = ['r', w, h, d, r, mat].join();
  if (!cache.has(key)) cache.set(key, slab(w, h, d, r, mat, { seg: 3 }));
  return { mesh: cache.get(key), matrix: chain(M, translate(...at)) };
}

function materials() {
  const colors = {
    steel: [.62, .66, .70], gun: [.20, .23, .26], polymer: [.12, .14, .16], rubber: [.10, .11, .12],
    glove: [.25, .29, .23], gloveHi: [.39, .44, .34], sleeve: [.18, .23, .20], brass: [.92, .70, .22],
    flash: [1, .84, .42], white: [.92, .94, .92],
  };
  return Object.fromEntries(Object.entries(colors).map(([id, color], i) => [id, { id: i + 1, color, emissive: id === 'flash' ? 1 : 0 }]));
}

function pose(name, t) {
  const s = Math.sin(t * TAU), c = Math.cos(t * TAU);
  const p = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0, slide: 0, mag: 0, flash: 0, lower: 0 };
  if (name === 'idle') { p.x = s * .18; p.y = c * .12; p.roll = s * .012; }
  if (name === 'walk') { p.x = s * .45; p.y = Math.abs(c) * .7; p.roll = s * .045; p.pitch = c * .02; }
  if (name === 'sprint') { p.x = s * .8; p.y = Math.abs(c) * 1.2; p.roll = s * .09; p.pitch = c * .05; p.lower = 2.2; }
  if (name === 'aim') { p.x = s * .06; p.y = c * .05 - .3; p.roll = s * .008; p.pitch = -.035; }
  if (name === 'draw') { p.lower = (1 - Math.min(1, t * 1.4)) * 9; p.pitch = (1 - t) * .3; }
  if (name === 'fire') {
    const kick = Math.sin(Math.min(1, t * 1.15) * Math.PI);
    p.x = -kick * 1.9; p.y = kick * .35; p.roll = kick * .06; p.pitch = -kick * .14;
    p.slide = -kick * 3.1; p.flash = t < .46 ? 1 : 0;
  }
  if (name === 'reload') {
    const tilt = Math.sin(Math.min(1, t * 1.1) * Math.PI);
    p.lower = tilt * 2.6; p.roll = -.12 * tilt; p.pitch = .16 * tilt;
    p.mag = Math.sin(Math.min(1, Math.max(0, (t - .3) / .45)) * Math.PI) * 5.5;
    p.slide = t > .82 ? -1.2 * Math.sin((t - .82) / .18 * Math.PI) : 0;
  }
  return p;
}

function gunParts(name, t) {
  const p = pose(name, t), M = chain(translate(p.x, p.y - p.lower, 0), scale(-1, 1, 1), rotY(-.34), rotZ(.36 + p.roll), rotX(p.pitch));
  const parts = [];
  const add = (w, h, d, mat, at, group = M, round = false) => parts.push(part(w, h, d, mat, at, group, round));
  const addRound = (w, h, d, r, mat, at, group = M) => parts.push(rounded(w, h, d, r, mat, at, group));
  // Slide, frame and barrel. The slide recoils independently.
  const slideM = chain(M, translate(p.slide, 0, 0));
  addRound(15.4, 3.1, 3.3, .32, 'gun', [8.2, 2.4, 0], slideM);
  add(15.6, .55, 3.45, 'steel', [8.2, 3.85, 0], slideM);
  add(14.8, 1.9, .1, 'polymer', [8.2, 2.3, 1.7], slideM);
  add(6.2, .35, 1.1, 'steel', [6.6, 4.05, 0], slideM);
  add(2.6, 1.1, 3.1, 'polymer', [.1, 1.45, 0], slideM);
  add(3.4, 1.45, 1.5, 'steel', [15.3, 2.4, 0], slideM);
  add(1.4, .8, 1.2, 'polymer', [17.0, 2.4, 0], slideM);
  add(.6, .8, .8, 'rubber', [17.8, 2.4, 0], slideM);
  addRound(12.2, 2.0, 3.0, .24, 'polymer', [7.1, .35, 0]);
  add(2.1, 1.0, 2.4, 'gun', [11.4, -.55, 0]);
  add(5.2, .7, .9, 'steel', [8.6, -1.0, 0]);
  add(1.7, .65, 1.0, 'steel', [4.6, .75, 1.7]);
  add(1.3, .8, 1.0, 'steel', [6.4, 1.0, 1.7]);
  add(.75, 3.4, .9, 'steel', [6.2, -2.2, 0]);
  add(.7, 1.4, 1.0, 'steel', [12.2, -1.8, 0]);
  // Trigger and trigger guard.
  add(.65, 2.1, .75, 'steel', [8.9, -1.15, 0]);
  add(3.8, .55, .9, 'gun', [8.2, -2.9, 0]);
  add(.6, 1.8, .9, 'gun', [6.4, -2.3, 0]);
  // Grip and magazine, canted back like a Glock.
  const gripM = chain(M, translate(-.2, -4.5, 0), rotZ(-.18));
  addRound(3.4, 8.2, 3.2, .45, 'polymer', [0, 0, 0], gripM);
  add(1.0, 6.8, 3.1, 'rubber', [-1.55, -.4, 0], gripM);
  for (let i = 0; i < 5; i++) add(2.8, .22, 3.28, 'rubber', [0, -1.2 - i * 1.05, 0], gripM);
  add(3.6, .8, 3.4, 'rubber', [0, -4.2, 0], gripM);
  add(2.9, 1.1, 3.5, 'gun', [0, -4.8, 0], gripM);
  const magM = chain(gripM, translate(0, -p.mag, 0));
  addRound(2.7, 7.4, 2.9, .22, 'steel', [0, -3.4, 0], magM);
  add(2.9, .8, 3.1, 'polymer', [0, -7.2, 0], magM);
  // Slide serrations and the ejection port.
  for (let i = 0; i < 5; i++) add(.42, 1.7, 3.38, 'steel', [12.2 + i * .72, 2.4, 0], slideM);
  add(2.5, 1.2, .12, 'polymer', [10.1, 3.2, 1.69], slideM);
  add(1.2, .5, .12, 'steel', [14.6, 2.4, 1.69], slideM);
  // Sights.
  add(.8, .75, 1.2, 'steel', [2.1, 4.15, 0], slideM);
  add(.65, .7, 1.8, 'steel', [14.5, 4.1, 0], slideM);
  // Glock markings: a tiny white model mark on the left flat.
  add(1.6, .38, .08, 'white', [8.2, 1.45, 1.7], slideM);
  // Hands. The right hand wraps the grip; the left supports the frame. Gloved
  // boxes and knuckles read more clearly than smooth blobs at viewmodel scale.
  add(3.5, 4.4, 2.8, 'glove', [-1.0, -4.3, 2.0], M);
  add(3.7, .7, 2.9, 'gloveHi', [-1.0, -2.4, 2.0], M);
  for (let i = 0; i < 4; i++) add(1.15, 1.0, 3.0, 'gloveHi', [1.45, -2.8 - i * 1.05, 1.9], M);
  add(1.2, 3.0, 1.3, 'glove', [-2.2, -5.1, 2.3], M);
  add(1.25, .8, 1.35, 'gloveHi', [-2.2, -3.9, 2.3], M);
  add(4.2, 4.4, 3.0, 'glove', [3.1, -2.2, 2.2], M);
  add(4.4, .7, 3.1, 'gloveHi', [3.1, -.7, 2.2], M);
  for (let i = 0; i < 3; i++) add(1.15, 1.0, 3.1, 'gloveHi', [5.0 + i * .9, -.9, 2.1], M);
  add(6.0, 4.8, 3.4, 'sleeve', [-2.4, -9.6, 1.2], M);
  add(6.1, .8, 3.5, 'rubber', [-2.4, -7.5, 1.2], M);
  add(5.8, 4.8, 3.3, 'sleeve', [3.4, -8.8, 1.6], M);
  add(5.9, .8, 3.4, 'rubber', [3.4, -6.8, 1.6], M);
  // Muzzle flash and a brass case on the fire frames.
  if (p.flash) {
    const FM = chain(M, translate(18.3, 2.4, 0), rotZ(-.2));
    add(3.2, 1.8, 1.8, 'flash', [0, 0, 0], FM);
    add(1.6, 4.8, 1.4, 'flash', [0, 0, 0], FM);
    add(5.6, 1.1, 1.1, 'flash', [0, 0, 0], FM);
    add(1.5, 1.5, 4.0, 'flash', [0, 0, 0], FM);
    add(2.2, 2.2, 2.2, 'flash', [0, 0, 0], FM, true);
  }
  // The Glock 18's selector lever and a small engraved model mark.
  add(1.0, .45, .12, 'steel', [3.0, 3.0, 1.7], slideM);
  add(1.0, .45, .12, 'steel', [4.2, 3.0, 1.7], slideM);
  // Compensator cuts near the muzzle: the 18's ported barrel.
  add(.7, .22, 2.4, 'polymer', [14.0, 4.0, 0], slideM);
  add(.7, .22, 2.4, 'polymer', [15.2, 4.0, 0], slideM);
  if (name === 'fire' && t > .25 && t < .7) add(.55, .55, 2.0, 'brass', [10.4, 3.7, 2.1 + (t - .25) * 5], M, true);
  return parts;
}

const materialsMap = materials();
const manifest = { version: 1, px: 10, cell: [W, H], anchor: [300, 190], columns: COLS, animations: {} };
const total = Object.values(clips).reduce((sum, [frames]) => sum + frames, 0);
const width = COLS * W, height = Math.ceil(total / COLS) * H;
const atlas = new Uint8ClampedArray(width * height * 4);
let index = 0;
for (const [name, [frames, duration, loop = true]] of Object.entries(clips)) {
  manifest.animations[name] = { start: index, frames, duration, loop };
  for (let f = 0; f < frames; f++) {
    const t = frames === 1 ? 1 : f / (loop ? frames : frames - 1);
    const target = makeTarget(W, H);
    render(target, gunParts(name, t), { camera: spriteCamera({ px: 10, origin: [300, 190] }), materials: materialsMap, lights: GUN_LIGHTS, snap: false });
    const rgba = ps1Quantize(target), ox = index % COLS * W, oy = Math.floor(index / COLS) * H;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = (y * W + x) * 4, d = ((oy + y) * width + ox + x) * 4;
      if (rgba[s + 3]) atlas.set(rgba.subarray(s, s + 4), d);
    }
    index++;
  }
}
const url = '/sprites/shadow-glock.png';
png(fileURLToPath(new URL(`public${url}`, ROOT)), width, height, atlas);
manifest.url = url;
fs.writeFileSync(new URL('src/shared/shadow-weapons.js', ROOT), `// Generated by tools/sprites/shadow/weapon.mjs. Do not edit by hand.\nexport const SHADOW_WEAPONS = ${JSON.stringify(manifest, null, 2)};\n`);
console.log('glock18', index, 'frames', width, height);
