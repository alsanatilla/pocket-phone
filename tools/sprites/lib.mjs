// Tiny pixel-art toolkit for Pocket's loading sprites. Everything draws into a 48×48 grid of palette letters.
export const N = 48;
const BAYER = [0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
export const bay = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + .5) / 16 - .5;
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const hash = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };

// Letters → colours are decided at run time from the accent, so every sprite follows Settings.
// o outline · d s a l h accent ramp (dark → highlight) · G g w greys · k black · t u screen glass · Y y z warning ramp
export const RAMPS = { accent: ['d','s','a','l','h'], grey: ['G','G','g','w','w'], warm: ['Y','Y','y','z','z'], white: ['g','g','w','w','w'] };

export class Grid {
  constructor() { this.p = new Array(N * N).fill('.'); }
  get(x, y) { return x < 0 || y < 0 || x >= N || y >= N ? '.' : this.p[y * N + x]; }
  set(x, y, c) { if (x >= 0 && y >= 0 && x < N && y < N) this.p[y * N + x] = c; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let i = 0; i <= n; i++) this.set(Math.round(x0 + (x1 - x0) * i / n), Math.round(y0 + (y1 - y0) * i / n), c); }
  /** Draws another grid on top; transparent cells stay transparent. */
  blit(other) { for (let i = 0; i < N * N; i++) if (other.p[i] !== '.') this.p[i] = other.p[i]; }
}

export const sdBox = (px, py, cx, cy, hw, hh, r = 0) => { const qx = Math.abs(px - cx) - (hw - r), qy = Math.abs(py - cy) - (hh - r); return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
export const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;
export const sdEllipse = (px, py, cx, cy, a, b) => {
  const x = (px - cx) / a, y = (py - cy) / b, k0 = Math.hypot(x, y), k1 = Math.hypot(x / a, y / b);
  return k1 > 0 ? k0 * (k0 - 1) / k1 : -Math.min(a, b);
};
export const sdCapsule = (px, py, ax, ay, bx, by, r) => {
  const pax = px - ax, pay = py - ay, bax = bx - ax, bay = by - ay, h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay || 1));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
};
const unit = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const LIGHT = unit([-.55, -.7, .62]);

/** A lit, dithered solid with a 1-pixel outline. The shape is a signed distance function; light comes from the top left. */
export function paint(g, sdf, { ramp = RAMPS.accent, depth = 5, outline = 'o', flat = null, light = LIGHT, tone = 0, dither = .2 } = {}) {
  const L = unit(light), base = L[2] / Math.hypot(0, 0, 1);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = x + .5, py = y + .5, d = sdf(px, py);
    if (d >= 1) continue;
    if (d >= 0) { if (outline) g.set(x, y, outline); continue; }
    if (flat) { g.set(x, y, flat); continue; }
    const e = .4, gx = sdf(px + e, py) - sdf(px - e, py), gy = sdf(px, py + e) - sdf(px, py - e), gl = Math.hypot(gx, gy) || 1;
    const h = Math.min(1, -d / depth), tilt = 1 - h * .88, nx = gx / gl * tilt, ny = gy / gl * tilt, nz = .3 + h * .7, nl = Math.hypot(nx, ny, nz);
    const delta = (nx * L[0] + ny * L[1] + nz * L[2]) / nl - base + tone + bay(x, y) * dither;
    g.set(x, y, delta > .42 ? ramp[4] : delta > .13 ? ramp[3] : delta > -.16 ? ramp[2] : delta > -.42 ? ramp[1] : ramp[0]);
  }
}
export function ellipseShadow(g, cx, cy, a, b, c = 'o') {
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const d = sdEllipse(x + .5, y + .5, cx, cy, Math.max(a, .5), Math.max(b, .5));
    if (d < 0 && (-d / Math.min(a, b + 1) > .25 || bay(x, y) < -.1)) g.set(x, y, c);
  }
}
export const sparkle = (g, x, y, s = 2, c = 'h') => { g.set(x, y, 'w'); for (let i = 1; i <= s; i++) { g.set(x - i, y, i === s ? c : 'w'); g.set(x + i, y, i === s ? c : 'w'); g.set(x, y - i, i === s ? c : 'w'); g.set(x, y + i, i === s ? c : 'w'); } };
export const ball = (g, x, y, r, ramp) => paint(g, (px, py) => sdCircle(px, py, x, y, r), { ramp, depth: r });

// ── Run-length encoding: "<count><letter>" pairs over the 2304 cells ──
export function encode(g) {
  let out = '', run = 1;
  for (let i = 1; i <= g.p.length; i++) { if (g.p[i] === g.p[i - 1]) run++; else { out += run + g.p[i - 1]; run = 1; } }
  return out;
}
