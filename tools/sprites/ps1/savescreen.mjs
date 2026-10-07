// The sync loader as a PlayStation 2 memory-card screen: pip's console body turns slowly over a misty blue glow,
// mirrored in a glossy floor, with drifting sparks and a soft bloom. Smooth 32-bit shading here, unlike the PS1 characters.
import { makeTarget, render, camera, chain, translate, rotY, rotX, scale } from './raster.mjs';
import { BODY, STEM, BULB, materials, ACCENT } from './pip3d.mjs';

const CAM = camera({ eye: [0, .42, 3.3], at: [0, .02, 0], fov: .6 });
const LIGHTS = { ambient: [.2, .22, .32], dirs: [{ dir: [-.5, .7, .9], color: [.78, .74, .68] }, { dir: [.8, -.1, .5], color: [.16, .24, .55] }, { dir: [.2, .4, -1], color: [.35, .45, .9] }] };
const FLOOR = -.52;
const fract = v => v - Math.floor(v);
const hash = k => fract(Math.sin(k * 91.7 + 13.1) * 43758.5453);

function project([x, y, z], S) {
  const v = CAM.view, f = 1 / Math.tan(CAM.fov / 2);
  const vx = v[0] * x + v[1] * y + v[2] * z + v[3], vy = v[4] * x + v[5] * y + v[6] * z + v[7], vz = v[8] * x + v[9] * y + v[10] * z + v[11];
  return [S / 2 + vx * f / -vz * S / 2, S / 2 - vy * f / -vz * S / 2, -vz];
}

export function saveFrame(i, n = 32, { size = 96, accent = ACCENT } = {}) {
  const S = size * 2, th = i / n * Math.PI * 2, bob = Math.sin(th * 2) * .045;
  const M = chain(translate(0, .12 + bob, 0), rotY(th - .4), rotX(.1), scale(.78));
  const mats = materials(accent, { expr: i % 16 === 11 ? 'blink' : 'happy' });
  for (const k of ['shell', 'back']) mats[k] = { ...mats[k], spec: [.42, 26] }; mats.face = { ...mats.face, spec: [.35, 40] };
  const parts = [{ mesh: BODY, matrix: M }, { mesh: STEM, matrix: M }, { mesh: BULB, matrix: M }];
  const model = makeTarget(S, S);
  render(model, parts, { camera: CAM, materials: mats, lights: LIGHTS, snap: false });

  // Composite at double resolution: mist, floor sheen, reflection, model, sparks.
  const img = new Float32Array(S * S * 4), [, floorY] = project([0, FLOOR, 0], S);
  const put = (x, y, rgb, a) => { if (x < 0 || y < 0 || x >= S || y >= S) return; const k = (y * S + x) * 4, oa = img[k + 3], na = a + oa * (1 - a); if (na <= 0) return; for (let c = 0; c < 3; c++) img[k + c] = (rgb[c] * a + img[k + c] * oa * (1 - a)) / na; img[k + 3] = na; };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S * .47), dy = (y - S * .5) / (S * .44), r = Math.hypot(dx, dy);
    if (r < 1) { const k = Math.pow(1 - r * r, 1.6), swirl = .85 + .15 * Math.sin(dx * 7 + th + Math.sin(dy * 5 - th)); put(x, y, [.04, .1 * swirl, .34 * swirl], k); }
    const fy = (y - floorY) / (S * .035), fx = (x - S / 2) / (S * .36);
    if (fy * fy + fx * fx < 1) put(x, y, accent.map(c => c * .5 + .25), .14 * (1 - fy * fy - fx * fx));
  }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const k = (y * S + x) * 4;
    // the glossy floor shows the visible picture flipped, as PS2 menus did
    const my = Math.round(2 * floorY - y), m = (my * S + x) * 4;
    if (y > floorY && my >= 0 && model.rgba[m + 3] > 0) put(x, y, [model.rgba[m], model.rgba[m + 1], model.rgba[m + 2]], .26 * Math.max(0, 1 - (y - floorY) / (S * .2)));
    if (model.rgba[k + 3] > 0) put(x, y, [model.rgba[k], model.rgba[k + 1], model.rgba[k + 2]], 1);
  }
  for (let p = 0; p < 11; p++) {
    const a = hash(p) * Math.PI * 2 + th * (hash(p + 7) > .5 ? .5 : -.5), rad = .55 + hash(p + 3) * .45, speed = .6 + hash(p + 5) * .8;
    const life = fract(hash(p + 11) + i / n * speed), white = hash(p + 17) > .55, rgb = white ? [1, 1, 1] : accent.map(c => Math.min(1, c * 1.1 + .1));
    for (let t = 0; t < 3; t++) {
      const l = life - t * .025; if (l < 0) continue;
      const [sx, sy, depth] = project([Math.cos(a) * rad, -.5 + l * 1.5, Math.sin(a) * rad], S), fade = Math.sin(l * Math.PI) * (1 - t * .28);
      const occluded = depth > 3.3 && model.rgba[(Math.round(sy) * S + Math.round(sx)) * 4 + 3] > 0;
      if (!occluded) for (const [ox, oy] of t === 0 ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0], [1, 0]]) put(Math.round(sx) + ox, Math.round(sy) + oy + t * 3, rgb, fade * (white ? .85 : .7) * (t ? .5 : 1));
    }
  }
  // down to final size (smooth edges), then bloom from the brightest parts
  const out = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = ((y * 2 + oy) * S + x * 2 + ox) * 4, w = img[k + 3]; r += img[k] * w; g += img[k + 1] * w; b += img[k + 2] * w; a += w; }
    const k = (y * size + x) * 4; if (a > 0) { out[k] = r / a; out[k + 1] = g / a; out[k + 2] = b / a; } out[k + 3] = a / 4;
  }
  const bright = new Float32Array(size * size * 3);
  for (let i2 = 0; i2 < size * size; i2++) { const k = i2 * 4, lum = (out[k] + out[k + 1] + out[k + 2]) / 3 * out[k + 3], e = Math.max(0, lum - .8) * 2.2; for (let c = 0; c < 3; c++) bright[i2 * 3 + c] = out[k + c] * e; }
  const blur = src => { const tmp = new Float32Array(src.length), dst = new Float32Array(src.length), R = 3;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let d = -R; d <= R; d++) s += src[(y * size + Math.min(size - 1, Math.max(0, x + d))) * 3 + c]; tmp[(y * size + x) * 3 + c] = s / (2 * R + 1); }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let c = 0; c < 3; c++) { let s = 0; for (let d = -R; d <= R; d++) s += tmp[(Math.min(size - 1, Math.max(0, y + d)) * size + x) * 3 + c]; dst[(y * size + x) * 3 + c] = s / (2 * R + 1); }
    return dst; };
  const glow = blur(blur(bright)), final = new Uint8ClampedArray(size * size * 4);
  for (let i2 = 0; i2 < size * size; i2++) {
    const k = i2 * 4, gl = (glow[i2 * 3] + glow[i2 * 3 + 1] + glow[i2 * 3 + 2]) / 3, a = Math.min(1, out[k + 3] + gl * 1.2);
    if (a <= 0) continue;
    for (let c = 0; c < 3; c++) final[k + c] = Math.round(Math.min(1, (out[k + c] * out[k + 3] + glow[i2 * 3 + c] * 1.3) / a) * 255);
    final[k + 3] = Math.round(a * 255);
  }
  return final;
}
export const SAVE_FRAMES = 32;
