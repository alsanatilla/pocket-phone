import { N, Grid, RAMPS, paint, sdBox, sdCircle, sdEllipse, sdCapsule, ellipseShadow, sparkle, ball, hash } from './lib.mjs';

// Pip is a little handheld console with legs: glowing eyes on a glass screen, d-pad, two buttons and a speaker.
const CX = 23.5, BOTTOM = 35, BASE = 5; // body bottom in source space; global drop that leaves room above for hops

function eyes(g, kind, gx = 0, gy = 0) {
  for (const cx of [19, 28]) {
    const x = cx + gx, y = 18 + gy;
    if (kind === 'blink') { g.rect(x - 1, y + 1, 3, 1, 'h'); continue; }
    if (kind === 'happy') { g.set(x - 2, y + 2, 'h'); g.set(x - 1, y + 1, 'h'); g.set(x, y, 'w'); g.set(x + 1, y + 1, 'h'); g.set(x + 2, y + 2, 'h'); g.set(x, y + 1, 'l'); continue; }
    if (kind === 'down') { g.rect(x - 1, y + 1, 3, 3, 'h'); g.rect(x, y + 2, 1, 1, 'w'); g.set(x - 1, y + 1, 'l'); g.set(x + 1, y + 3, 'l'); continue; }
    if (kind === 'wide') { g.rect(x - 1, y - 2, 3, 7, 'h'); g.rect(x - 2, y - 1, 5, 5, 'h'); g.rect(x, y - 1, 1, 5, 'w'); g.set(x - 2, y - 1, 'l'); g.set(x + 2, y + 3, 'l'); g.set(x - 1, y - 1, 'w'); continue; }
    g.rect(x - 1, y - 1, 3, 5, 'h'); g.rect(x - 2, y, 1, 3, 'l'); g.rect(x + 2, y, 1, 3, 'l'); g.rect(x, y, 1, 3, 'w'); g.set(x - 1, y - 1, 'w'); g.set(x - 1, y + 3, 'l'); g.set(x + 1, y + 3, 'l');
  }
}
function mouth(g, kind) {
  if (kind === 'smile') { g.set(22, 22, 'h'); g.set(23, 23, 'h'); g.set(24, 23, 'h'); g.set(25, 22, 'h'); }
  else if (kind === 'o') { g.rect(23, 22, 2, 2, 'h'); g.set(23, 22, 'w'); }
  else if (kind === 'flat') g.rect(22, 23, 4, 1, 'l');
}

/** The body with its face and controls in source space; scaled and moved afterwards. */
function body({ eye = 'open', gx = 0, gy = 0, mouthKind = 'smile', cheeks = false } = {}) {
  const g = new Grid();
  paint(g, (x, y) => sdCapsule(x, y, CX, 10, CX, 5.5, .9), { flat: 'd' });
  paint(g, (x, y) => sdCircle(x, y, CX, 4.6, 2.6), { depth: 2.6 });
  g.set(22, 3, 'w');
  paint(g, (x, y) => sdBox(x, y, CX, 22.2, 14, 12.8, 9.5), { depth: 6.5, tone: .26, dither: .1 });
  for (const [x, y] of [[17,11],[18,10],[19,10],[20,10],[15,12],[14,13],[13,14],[12,16]]) g.set(x, y, 'h');
  g.set(21, 10, 'l'); g.set(12, 17, 'l');
  paint(g, (x, y) => sdBox(x, y, CX, 18.9, 10.9, 7.4, 4.6), { flat: 'd', outline: 'o' });
  paint(g, (x, y) => sdBox(x, y, CX, 18.9, 9.8, 6.5, 3.6), { flat: 't', outline: null });
  for (let y = 13; y <= 25; y += 2) for (let x = 14; x <= 33; x++) if (g.get(x, y) === 't') g.set(x, y, 'u');
  for (const [x, y] of [[15,15],[16,15],[17,15],[15,16]]) if (g.get(x, y) !== '.') g.set(x, y, 'a');
  eyes(g, eye, gx, gy); mouth(g, mouthKind);
  if (cheeks) { g.set(16, 22, 'a'); g.set(17, 22, 'a'); g.set(30, 22, 'a'); g.set(31, 22, 'a'); }
  // control panel: a lighter plate under the screen, so the d-pad and buttons read
  paint(g, (x, y) => sdBox(x, y, CX, 30.9, 11.7, 3.9, 2), { flat: 'a', outline: 'd' });
  for (let x = 12; x < 36; x++) { if (g.get(x, 28) === 'a') g.set(x, 28, 'l'); if (g.get(x, 33) === 'a') g.set(x, 33, 's'); }
  // d-pad (dark, bevelled), speaker slits, A and B
  g.rect(16, 28, 3, 6, 'o'); g.rect(14, 29, 7, 3, 'o'); g.set(17, 30, 'd'); g.rect(16, 28, 3, 1, 's'); g.set(14, 29, 's');
  for (const x of [22, 24, 26]) g.rect(x, 29, 1, 4, 's');
  paint(g, (x, y) => sdCircle(x, y, 29.6, 31.2, 2.2), { ramp: RAMPS.warm, depth: 2.3 });
  paint(g, (x, y) => sdCircle(x, y, 33.2, 30, 1.9), { ramp: RAMPS.white, depth: 2 });
  return g;
}
const T = (x, y, s) => [CX + (x - CX) * s.sx + s.dx, BOTTOM + (y - BOTTOM) * s.sy + s.dy];

function place(dst, src, s) {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = Math.floor((x + .5 - s.dx - CX) / s.sx + CX), sy = Math.floor((y + .5 - s.dy - BOTTOM) / s.sy + BOTTOM), c = src.get(sx, sy);
    if (c !== '.') dst.set(x, y, c);
  }
}
const arm = (g, from, to, hand = 2.4) => {
  paint(g, (x, y) => sdCapsule(x, y, from[0], from[1], to[0], to[1], 1.5), { depth: 1.5 });
  paint(g, (x, y) => sdCircle(x, y, to[0], to[1], hand), { depth: hand });
  g.set(Math.round(to[0] - 1), Math.round(to[1] - 1), 'h');
};
const foot = (g, x, y) => paint(g, (px, py) => sdEllipse(px, py, x, y, 4.6, 2.7), { depth: 2.7 });

/** One frame. `s` squashes and moves the body; feet, arms and props are placed in frame space. */
function frame({ s = {}, feet = [0, 0, 0, 0], arms = null, face = {}, behind = null, front = null, shadow = 1 } = {}) {
  const st = { sx: 1, sy: 1, dx: 0, dy: BASE, ...s }, g = new Grid();
  ellipseShadow(g, CX + st.dx * .6, 45.4, 12.5 * shadow, 2.2 * shadow);
  behind?.(g, st);
  const fy = BOTTOM + st.dy + 1.9;
  foot(g, 17.6 + feet[0] + st.dx, fy + feet[1]); foot(g, 29.4 + feet[2] + st.dx, fy + feet[3]);
  place(g, body(face), st);
  const [lx, ly] = T(9.6, 22, st), [rx, ry] = T(37.4, 22, st);
  const a = arms || { l: [-3, 6], r: [3, 6] };
  arm(g, [lx, ly], [lx + a.l[0], ly + a.l[1]]); arm(g, [rx, ry], [rx + a.r[0], ry + a.r[1]]);
  front?.(g, st);
  return g;
}

const wave = i => {
  const t = i / 8 * Math.PI * 2, hand = [5, 7, 5, 3, 5, 7, 5, 3][i];
  return frame({ s: { dy: BASE + Math.round(Math.sin(t) * .9) }, arms: { l: [-3, 6], r: [hand - 1, -10 - (i % 2 ? 0 : 1)] },
    face: { eye: i === 5 ? 'blink' : i >= 2 && i <= 4 ? 'happy' : 'open', gx: 1, mouthKind: 'smile', cheeks: i >= 2 && i <= 4 },
    front: i === 3 || i === 7 ? (g, st) => { const [x, y] = T(37.4, 22, st); sparkle(g, Math.round(x + 9), Math.round(y - 14), 2); g.set(Math.round(x + 5), Math.round(y - 17), 'l'); } : null });
};
const walk = i => {
  const t = i / 8 * Math.PI * 2, dir = Math.sign(Math.cos(t)) || 1, step = i % 2, dx = Math.round(Math.sin(t) * 5);
  const lift = step ? [0, 0, dir, -2] : [dir, -2, 0, 0];
  return frame({ s: { dx, dy: BASE - step }, feet: lift, arms: { l: [-3 + (step ? 2 : -1), 6], r: [3 + (step ? -1 : 2), 6] },
    face: { eye: i === 6 ? 'blink' : 'open', gx: dir, mouthKind: 'flat' } });
};
const juggle = i => {
  const t = i / 8 * Math.PI * 2, orbs = [0, 1, 2].map(k => { const a = t + k * Math.PI * 2 / 3; return { x: 23.5 + Math.cos(a) * 15, y: 5 + Math.sin(a) * 4.5, front: Math.sin(a) > 0, ramp: [RAMPS.accent, RAMPS.white, RAMPS.warm][k] }; });
  const near = orbs.reduce((b, o) => o.y < b.y ? o : b);
  const draw = list => g => { for (const o of list) { ball(g, Math.round(o.x), Math.round(o.y + 4), 3, o.ramp); g.set(Math.round(o.x - 1), Math.round(o.y + 3), 'w'); } };
  return frame({ s: { dy: BASE + (i % 4 === 1 ? 1 : 0) }, arms: { l: [-1, -9 + (i % 4 < 2 ? 0 : 1)], r: [1, -9 + (i % 4 < 2 ? 1 : 0)] },
    face: { eye: i === 6 ? 'blink' : 'open', gx: Math.round(Math.cos(Math.atan2(near.y - 5, near.x - 23.5)) * 1.4), gy: -1, mouthKind: i % 4 < 2 ? 'o' : 'smile' },
    behind: draw(orbs.filter(o => !o.front)), front: draw(orbs.filter(o => o.front)) });
};
const read = i => {
  const scan = Math.min(1, (i % 6) / 5), flip = i >= 6, gx = Math.round(-1 + 2 * scan);
  return frame({ s: { dy: BASE + (i === 3 ? 1 : 0) }, arms: { l: [2, 8], r: [-2, 8] }, face: { eye: i === 5 ? 'blink' : 'down', gx: flip ? 1 : gx, gy: 0, mouthKind: 'flat' },
    front: (g, st) => {
      const y0 = Math.round(BOTTOM + st.dy - 6);
      g.rect(10, y0 + 1, 28, 11, 'o'); g.rect(11, y0 + 2, 26, 9, 'd'); g.rect(11, y0 + 11, 26, 1, 's');
      g.rect(12, y0, 11, 10, 'o'); g.rect(13, y0 + 1, 10, 8, 'w');
      const rw = flip ? (i === 6 ? 5 : 2) : 10; g.rect(24, y0, rw + 2, 10, 'o'); g.rect(24, y0 + 1, rw, 8, i === 6 ? 'g' : 'w');
      g.rect(23, y0 + 1, 1, 8, 'g');
      for (let k = 0; k < 3; k++) { g.rect(14, y0 + 2 + k * 2, 8 - (k === 2 ? 3 : 0), 1, 'g'); if (!flip) g.rect(25, y0 + 2 + k * 2, 8 - (k === 1 ? 2 : 0), 1, 'g'); }
      if (!flip) { const k = Math.min(2, Math.floor(scan * 3)); g.rect(25, y0 + 2 + k * 2, 6, 1, 'a'); }
      g.rect(13, y0 + 8, 1, 1, 'l');
    } });
};
const hop = i => {
  const S = [{ sy: .84, sx: 1.12, up: 0 }, { sy: 1.1, sx: .92, up: 2 }, { sy: 1.05, sx: .96, up: 4 }, { sy: 1, sx: 1, up: 4 }, { sy: 1.07, sx: .95, up: 2 }, { sy: .8, sx: 1.15, up: 0 }, { sy: .93, sx: 1.05, up: 0 }, { sy: 1, sx: 1, up: 0 }][i];
  const air = S.up > 1, apex = i === 2 || i === 3;
  return frame({ s: { sx: S.sx, sy: S.sy, dy: BASE - S.up }, feet: air ? [1, -2, -1, -2] : [0, 0, 0, 0], shadow: 1 - S.up * .09,
    arms: apex ? { l: [-4, -8], r: [4, -8] } : air ? { l: [-3, -3], r: [3, -3] } : i === 0 ? { l: [-1, 7], r: [1, 7] } : { l: [-3, 6], r: [3, 6] },
    face: { eye: apex ? 'happy' : i === 5 ? 'blink' : i === 0 ? 'wide' : 'open', mouthKind: apex ? 'o' : 'smile', cheeks: apex },
    front: i === 5 || i === 6 ? g => { const k = i === 5 ? 0 : 2; for (const [x, y, c] of [[8 - k, 43, 'g'], [6 - k, 42, 'w'], [5 - k, 44, 'g'], [39 + k, 43, 'g'], [41 + k, 42, 'w'], [42 + k, 44, 'g']]) g.set(x, y, c); } : null });
};
const write = i => {
  const row = Math.min(2, Math.floor(i / 3));
  return frame({ s: { dy: BASE + (i % 2) }, arms: { l: [2, 9], r: [-3, 8] }, face: { eye: i === 7 ? 'blink' : 'down', gx: Math.round(-1 + (i % 4) * .6), mouthKind: i % 4 === 3 ? 'o' : 'flat' },
    front: (g, st) => {
      const y0 = Math.round(BOTTOM + st.dy - 6);
      g.rect(11, y0, 25, 11, 'o'); g.rect(12, y0 + 1, 23, 9, 'w'); g.rect(12, y0 + 9, 23, 1, 'g');
      for (let k = 0; k < 3; k++) g.rect(14, y0 + 2 + k * 3, 19, 1, 'g');
      for (let k = 0; k <= row; k++) { const len = k < row ? 15 : 3 + (i % 3) * 4; for (let x = 0; x < len; x++) g.set(14 + x, y0 + 2 + k * 3 - (hash(x, k) > .66 ? 1 : 0), 'a'); }
      const px = 14 + (row < 2 || i % 3 ? 3 + (i % 3) * 4 + 4 : 4), py = y0 + 3 + row * 3;
      for (let k = 0; k < 8; k++) { g.set(px + k, py - k, k < 6 ? (k % 2 ? 'y' : 'z') : 'o'); g.set(px + k + 1, py - k, 'Y'); }
      g.set(px, py, 'k'); g.set(px + 1, py - 1, 'g'); g.set(px + 2, py - 2, 'z');
    } });
};
const pull = i => {
  const sy = [.99, .93, .87, .8][i], sx = [1.01, 1.05, 1.09, 1.14][i];
  return frame({ s: { sy, sx }, feet: [-i * .6, 0, i * .6, 0], arms: { l: [-4 - i * .3, 5 + i], r: [4 + i * .3, 5 + i] }, face: { eye: i > 1 ? 'wide' : 'open', mouthKind: i > 2 ? 'o' : 'flat' }, shadow: 1 + i * .06 });
};

const make = (fn, n) => [...Array(n)].map((_, i) => fn(i));
export const PIP_ORDER = ['wave', 'walk', 'juggle', 'read', 'hop', 'write', 'pull'];
export const PIP = { wave: make(wave, 8), walk: make(walk, 8), juggle: make(juggle, 8), read: make(read, 8), hop: make(hop, 8), write: make(write, 8), pull: make(pull, 4) };
