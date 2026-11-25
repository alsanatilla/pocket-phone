// Renders Shadow Protocol's yard props (wrecks, drums, sandbags, a fire barrel) from low-poly models
// through the ¾ sprite camera into one sheet, public/sprites/shadow-props.png, with its manifest in
// src/shared/shadow-props.js. Model space: x east, y NORTH, z up, world units; a prop's footprint
// runs from its north-west corner at the origin to (w, −d).
//   node tools/sprites/shadow/props.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { box, tube, ball, chain, translate, rotX, rotZ, render, makeTarget } from '../ps1/raster.mjs';
import { spriteCamera, SPRITE_LIGHTS } from './camera.mjs';
import { K, V, SPRITE_PX } from '../../../src/client/shadow-view.js';
import { png } from '../ps1/apng.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PX = SPRITE_PX, PAD = 4;

// Materials. `rust` marks surfaces that get blotches of corrosion in the grit pass.
const M = {};
const MATERIALS = [];
const mat = (name, color, extra = {}) => { M[name] = MATERIALS.length; MATERIALS.push({ id: MATERIALS.length, color, ...extra }); };
mat('paint', [.56, .24, .19], { rust: .5 });
mat('rust', [.46, .3, .19], { rust: .9 });
mat('glass', [.11, .14, .17]);
mat('tyre', [.09, .09, .1]);
mat('char', [.27, .23, .2], { rust: .5 });
mat('ash', [.4, .36, .32], { rust: .5 });
mat('steel', [.46, .48, .5], { rust: .35 });
mat('blue', [.2, .33, .47], { rust: .45 });
mat('yellow', [.63, .5, .2], { rust: .4 });
mat('band', [.25, .25, .26], { rust: .5 });
mat('sand', [.7, .63, .46]);
mat('sand2', [.6, .53, .38]);
mat('barrel', [.4, .26, .16], { rust: .8 });
mat('hollow', [.05, .045, .04]);
mat('lamp', [.8, .76, .62]);

// Places a mesh: game-space position (x east, y SOUTH), height z, turn about z (game facing, clockwise on screen).
const at = (mesh, x, y, z, turn = 0, extra = []) => ({ mesh, matrix: chain(translate(x, -y, z), rotZ(-turn), ...extra) });
const upright = rotX(Math.PI / 2);

function car() {
  // A rusted sedan on flat tyres, nosed slightly off the grid, one wheel gone.
  const parts = [], cx = 24, cy = 16, turn = -.2;
  const local = (x, y, z, mesh, extra = []) => {
    const c = Math.cos(turn), s = Math.sin(turn);
    return at(mesh, cx + x * c - y * s, cy + x * s + y * c, z, turn, extra);
  };
  parts.push(local(0, 0, 7, box(40, 18, 7, M.paint)));
  parts.push(local(18.5, 0, 7.5, box(4, 17, 5, M.rust)));
  parts.push(local(-18.5, 0, 7.5, box(4, 17, 5, M.rust)));
  parts.push(local(-1, 0, 13.5, box(19, 15.4, 6, M.paint)));
  parts.push(local(8.6, 0, 13.4, box(1.4, 14, 5, M.glass)));
  parts.push(local(-10.6, 0, 13.4, box(1.4, 14, 5, M.glass)));
  parts.push(local(-1, 7.8, 13.4, box(16, .8, 4.2, M.glass)));
  parts.push(local(-1, -7.8, 13.4, box(16, .8, 4.2, M.glass)));
  parts.push(local(20.6, 5.5, 8, box(.8, 3, 1.6, M.lamp)));
  parts.push(local(20.6, -5.5, 8, box(.8, 3, 1.6, M.rust)));
  for (const [x, y, z] of [[13, 9.6, 2.6], [-13, 9.6, 3.2], [13, -9.6, 3.2]]) parts.push(local(x, y, z, tube(3.4, 3.4, -1.5, 1.5, M.tyre, { sides: 8 })));
  parts.push(local(-13, -9.2, 2.2, box(4, 2, 2, M.rust)));
  return { name: 'car', w: 48, d: 32, h: 18, parts };
}

function van() {
  // A burned-out van, turned across its spot.
  const parts = [], cx = 16, cy = 16, turn = .55;
  const local = (x, y, z, mesh) => { const c = Math.cos(turn), s = Math.sin(turn); return at(mesh, cx + x * c - y * s, cy + x * s + y * c, z, turn); };
  parts.push(local(0, 0, 10, box(28, 15, 14, M.char)));
  parts.push(local(13.5, 0, 7.5, box(4, 14, 8, M.ash)));
  parts.push(local(12, 0, 13, box(1.2, 12, 4.4, M.glass)));
  parts.push(local(2, 7.6, 12, box(16, .8, 5, M.glass)));
  parts.push(local(-6, 0, 17.4, box(14, 13, .8, M.ash)));
  for (const [x, y] of [[9, 8], [-9, 8], [9, -8], [-9, -8]]) parts.push(local(x, y, 2.2, tube(2.6, 2.6, -1.2, 1.2, M.tyre, { sides: 7 })));
  return { name: 'van', w: 32, d: 32, h: 24, parts };
}

function drums() {
  const parts = [];
  const drum = (x, y, color) => {
    parts.push(at(tube(4.2, 4.2, 0, 11, M[color], { sides: 9 }), x, y, 0, 0, [upright]));
    for (const z of [3.4, 7.6]) parts.push(at(tube(4.4, 4.4, -.35, .35, M.band, { sides: 9 }), x, y, z, 0, [upright]));
  };
  drum(6, 8, 'blue'); drum(15, 6.5, 'yellow');
  // One knocked over, rolled against the others.
  parts.push(at(tube(4.2, 4.2, -5.5, 5.5, M.blue, { sides: 9 }), 25, 9.5, 4.2, 0, [rotZ(-Math.PI / 2 - .3)]));
  return { name: 'drums', w: 32, d: 16, h: 12, parts };
}

function sandbags() {
  const parts = [];
  for (let row = 0; row < 3; row++) {
    const count = row === 2 ? 5 : 6, z = 2 + row * 3.6, offset = row % 2 ? 2.6 : 0;
    for (let i = 0; i < count; i++) {
      const x = 3 + offset + i * 5.2 + (row === 2 ? 2.4 : 0);
      if (x > 30) continue;
      parts.push(at(ball(2.9, 4.6, 2, (i + row) % 2 ? M.sand : M.sand2, { slices: 8, stacks: 5 }), x, 9 + (row === 1 ? -.6 : 0), z, 0, [rotZ(Math.PI / 2)]));
    }
  }
  return { name: 'sandbags', w: 32, d: 16, h: 12, parts };
}

function fireBarrel() {
  const parts = [];
  parts.push(at(tube(5, 5, 0, 12, M.barrel, { sides: 10 }), 8, 9, 0, 0, [upright]));
  parts.push(at(tube(5.3, 5.3, -.4, .4, M.band, { sides: 10 }), 8, 9, 11.6, 0, [upright]));
  parts.push(at(tube(4.4, 4.4, -.1, .1, M.hollow, { sides: 10 }), 8, 9, 11.9, 0, [upright]));
  for (const [x, y] of [[4.6, 12.8], [12.5, 11.6], [7, 4.6]]) parts.push(at(box(1.6, 1, 1.2, M.hollow), x, y, .6));
  return { name: 'fireBarrel', w: 16, d: 16, h: 13, parts, fire: { x: 8, y: 9, z: 12.4 } };
}

/** Grit: brightness jitter on every surface and corrosion blotches on rusty ones. */
function grit(target) {
  const { w, h, rgba } = target;
  const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    return (hash(xi, yi) * (1 - ux) + hash(xi + 1, yi) * ux) * (1 - uy) + (hash(xi, yi + 1) * (1 - ux) + hash(xi + 1, yi + 1) * ux) * uy;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] <= 0) continue;
    const id = target.mat[y * w + x], m = MATERIALS[id];
    let k = .93 + hash(x * .7, y * 1.3) * .14;
    if (m?.rust) {
      const blot = noise(x / 6, y / 6) * .7 + noise(x / 2.5, y / 2.5) * .3;
      if (blot > 1 - m.rust * .55) { rgba[i] = rgba[i] * .7 + .42 * .3 * k; rgba[i + 1] = rgba[i + 1] * .62 + .22 * .3 * k; rgba[i + 2] = rgba[i + 2] * .5 + .1 * .3 * k; k *= .85; }
    }
    rgba[i] *= k; rgba[i + 1] *= k; rgba[i + 2] *= k;
  }
}

/** 8-bit colour with the same 4×4 dither Pip uses, then a dark one-pixel outline around the silhouette. */
function finish(target) {
  const { w, h, rgba } = target, out = new Uint8ClampedArray(w * h * 4);
  const DITHER = [[-4, 0, -3, 1], [2, -2, 3, -1], [-3, 1, -4, 0], [3, -1, 2, -2]];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (rgba[i + 3] <= 0) continue;
    for (let k = 0; k < 3; k++) { const v = Math.max(0, Math.min(255, Math.round(rgba[i + k] * 255) + DITHER[y & 3][x & 3])) >> 3; out[i + k] = v << 3 | v >> 2; }
    out[i + 3] = 255;
  }
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && out[(y * w + x) * 4 + 3] > 0;
  const edge = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) edge.push((y * w + x) * 4);
  for (const i of edge) { out[i] = 10; out[i + 1] = 10; out[i + 2] = 13; out[i + 3] = 235; }
  return out;
}

const props = [car(), van(), drums(), sandbags(), fireBarrel()];
const rendered = props.map(prop => {
  const head = prop.h * V + PAD;
  const w = Math.ceil((prop.w + PAD * 2) * PX), h = Math.ceil((prop.d * K + head + PAD) * PX);
  const target = makeTarget(w, h);
  render(target, prop.parts, { camera: spriteCamera({ px: PX, origin: [PAD * PX, head * PX] }), materials: MATERIALS, lights: SPRITE_LIGHTS, snap: false });
  grit(target);
  return { prop, w, h, ox: PAD * PX, oy: Math.round(head * PX), pixels: finish(target) };
});

// One row per prop is plenty for five props: stack them.
const sheetW = Math.max(...rendered.map(r => r.w)), sheetH = rendered.reduce((sum, r) => sum + r.h, 0);
const sheet = new Uint8ClampedArray(sheetW * sheetH * 4);
const manifest = {};
let top = 0;
for (const r of rendered) {
  for (let y = 0; y < r.h; y++) sheet.set(r.pixels.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((top + y) * sheetW) * 4);
  manifest[r.prop.name] = { x: 0, y: top, w: r.w, h: r.h, ox: r.ox, oy: r.oy, ...(r.prop.fire ? { fire: r.prop.fire } : {}) };
  top += r.h;
}
fs.mkdirSync(path.join(root, 'public/sprites'), { recursive: true });
png(path.join(root, 'public/sprites/shadow-props.png'), sheetW, sheetH, sheet);
fs.writeFileSync(path.join(root, 'src/shared/shadow-props.js'), `// Generated by tools/sprites/shadow/props.mjs. Do not edit by hand.
// Yard props rendered through the ¾ sprite camera. Sheet: /sprites/shadow-props.png at SPRITE_PX pixels per world unit.
// Each entry: the cell (x, y, w, h) and the pixel (ox, oy) where the prop's north-west ground corner sits.
export const PROP_SHEET = '/sprites/shadow-props.png';
export const PROP_SPRITES = ${JSON.stringify(manifest, null, 2)};
`.replace(/\n/g, '\r\n'));
console.log(`props: ${sheetW}×${sheetH}, ${fs.statSync(path.join(root, 'public/sprites/shadow-props.png')).size} bytes`);
