import { N, Grid, bay, clamp, ellipseShadow, sparkle, hash } from './lib.mjs';

// A game cartridge turning in a tiny software 3D renderer: flat-shaded, dithered, with a label drawn as a texture.
const FRAMES = 16, TILT = -.34, T = 3.6;
const OUTLINE = [[-9, -16], [9, -16], [13, -12], [13, 15], [-13, 15], [-13, -12]];
const L = (() => { const v = [-.5, -.6, .65], l = Math.hypot(...v); return v.map(x => x / l); })();
const SHELL = ['d', 's', 'a', 'l', 'h'];

function rot(x, y, z, th) {
  const x1 = x * Math.cos(th) + z * Math.sin(th), z1 = -x * Math.sin(th) + z * Math.cos(th);
  return [x1, y * Math.cos(TILT) - z1 * Math.sin(TILT), y * Math.sin(TILT) + z1 * Math.cos(TILT)];
}
const proj = ([x, y]) => [24 + x, 26 + y];
const shade = (n, tone = 0, x = 0, y = 0) => {
  const d = n[0] * L[0] + n[1] * L[1] + n[2] * L[2] + tone + bay(x, y) * .16;
  return d > .88 ? SHELL[4] : d > .62 ? SHELL[3] : d > .34 ? SHELL[2] : d > .12 ? SHELL[1] : SHELL[0];
};

/** Front label: accent shell, white paper with a tiny Pip on a screen, ink lines, and ridges at the bottom. */
function front(u, v) {
  if (u > -9.5 && u < 9.5 && v > -12 && v < 3.5) {
    if (u < -8.6 || u > 8.6 || v < -11.1 || v > 2.6) return 'g';
    if (v < -7.6) return v < -9.6 ? 'a' : 'l';
    if (u > -4.5 && u < 4.5 && v > -6.5 && v < -0.5) {
      if (u < -3.6 || u > 3.6 || v < -5.6 || v > -1.4) return 'd';
      if ((v > -4.6 && v < -3.4) && ((u > -2.6 && u < -1.4) || (u > 1.4 && u < 2.6))) return 'h';
      return Math.floor(v) % 2 ? 't' : 'u';
    }
    if (v > 0.2 && v < 1.4 && u > -6 && u < 6) return 'g';
    return 'w';
  }
  if (v > 12.2 && u > -11 && u < 11) return Math.floor(u + 11) % 2 ? 'Y' : 'y';
  if (v > 6) return Math.floor(v) % 2 ? 'a' : 's';
  if (v > 3.5 && v <= 6) return 'l';
  return null;
}
const back = (u, v) => (u > -8 && u < 8 && v > -8 && v < 2 ? ((u + v) % 4 < 2 ? 'g' : 'G') : v > 6 ? (Math.floor(v) % 2 ? 'a' : 's') : null);

function inside(poly, x, y) {
  let pos = 0, neg = 0, edge = 99;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length], cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax), len = Math.hypot(bx - ax, by - ay) || 1;
    if (cr > 0) pos++; else neg++;
    edge = Math.min(edge, Math.abs(cr) / len);
  }
  return { in: !(pos && neg), edge };
}

export function cart(i, frames = FRAMES) {
  const th = i / frames * Math.PI * 2, g = new Grid(), sinT = Math.sin(th), cosTh = Math.cos(th), sT = Math.sin(TILT), cT = Math.cos(TILT);
  ellipseShadow(g, 24, 45.2, 13 - Math.abs(sinT) * 3, 2.2);
  const pt = (x, y, z) => rot(x, y, z, th), faces = [];
  faces.push({ kind: "front", poly: OUTLINE.map(([x, y]) => pt(x, y, T)), n: rot(0, 0, 1, th) });
  faces.push({ kind: "back", poly: OUTLINE.map(([x, y]) => pt(x, y, -T)), n: rot(0, 0, -1, th) });
  for (let k = 0; k < OUTLINE.length; k++) {
    const a = OUTLINE[k], b = OUTLINE[(k + 1) % OUTLINE.length], ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey);
    faces.push({ kind: "side", poly: [pt(a[0], a[1], T), pt(b[0], b[1], T), pt(b[0], b[1], -T), pt(a[0], a[1], -T)], n: rot(ey / len, -ex / len, 0, th), top: k === 0 });
  }
  for (const f of faces) {
    if (f.n[2] < .03) continue; // turned away
    const poly = f.poly.map(proj), xs = poly.map(p => p[0]), ys = poly.map(p => p[1]), z = f.kind === "front" ? T : -T;
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(N - 1, Math.ceil(Math.max(...ys))); y++) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(N - 1, Math.ceil(Math.max(...xs))); x++) {
      const r = inside(poly, x + .5, y + .5); if (!r.in) continue;
      let c;
      if (f.kind !== "side") {
        // Undo the face's projection to find the texel under this pixel (skipped when the face is nearly edge-on).
        const edgeOn = Math.abs(cosTh) < .22, u = (x + .5 - 24 - z * sinT) / (cosTh || .001), v = (y + .5 - 26 - u * sinT * sT + z * cosTh * sT) / cT;
        const tex = edgeOn ? null : f.kind === "front" ? front(u, v) : back(u, v);
        const tone = tex && "dslh".includes(tex) ? ({ d: -.3, s: -.14, l: .2, h: .4 })[tex] : tex === "a" ? .02 : 0;
        c = tex && !"dsalh".includes(tex) ? tex : shade(f.n, tone, x, y);
      } else c = shade(f.n, f.top ? .2 : -.05, x, y);
      if (r.edge < .6) c = f.kind === "front" ? "l" : c === "h" ? "l" : "d";
      g.set(x, y, c);
    }
  }
  const o = new Grid();
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (g.get(x, y) === "." && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(x + dx, y + dy) !== "." && g.get(x + dx, y + dy) !== "o")) o.set(x, y, "o");
  g.blit(o);
  if (i === 0 || i === frames - 1) sparkle(g, 37, 11, 2);
  return g;
}
export const CART = [...Array(FRAMES)].map((_, i) => cart(i));
