import { N, Grid, bay, ellipseShadow, sparkle } from './lib.mjs';

// A spinning coin in the style of an 8-bit pick-up: the face is squeezed horizontally, with a rim, an embossed star and a glint.
const FRAMES = 12, R = 16, CY = 24, CXC = 24;
const STAR = [...Array(10)].map((_, k) => { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? .36 : 1; return [Math.cos(a) * r, Math.sin(a) * r]; });
const star = (u, v) => { let hit = false; for (let i = 0, j = STAR.length - 1; i < STAR.length; j = i++) { const [xi, yi] = STAR[i], [xj, yj] = STAR[j]; if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) hit = !hit; } return hit; };
const ring = (u, v) => { const r = Math.hypot(u, v); return r > .22 && r < .5 || r < .09; };

export function coin(i, frames = FRAMES) {
  const th = i / frames * Math.PI * 2, c = Math.cos(th), g = new Grid(), w = Math.abs(c) * R, thick = Math.round(Math.abs(Math.sin(th)) * 4);
  ellipseShadow(g, CXC, 45, 3 + w * .8, 2);
  const lean = Math.sign(Math.sin(th)) || 1;
  // the coin's edge is a second, darker disc behind the face
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    for (let t = thick; t >= 0; t--) {
      const px = x + .5 - CXC + t * lean * -1, py = y + .5 - CY, hw = Math.max(w, 1.4), q = Math.hypot(px / hw, py / R);
      if (q <= 1 && t > 0) { g.set(x, y, py < -R * .55 ? 'l' : (px * lean < 0 ? 'd' : 's')); break; }
    }
  }
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const hw = Math.max(w, 1.4), px = x + .5 - CXC, py = y + .5 - CY, u = px / hw, v = py / R, q = Math.hypot(u, v);
    if (q > 1) { if (q < 1 + 1.2 / R && w > 1.6) g.set(x, y, 'o'); continue; }
    if (w < 2.2) { g.set(x, y, Math.abs(px) < .7 ? 'h' : px < 0 ? 'l' : 's'); continue; }
    let col;
    const lit = -u * .55 - v * .85;
    if (q > .84) col = lit > .25 ? 'h' : lit > -.35 ? 'l' : 'a';
    else if (q > .76) col = lit > 0 ? 'd' : 'l';
    else {
      const sx = c > 0 ? u : -u, sym = c > 0 ? star(sx * 1.2, v * 1.2) : ring(sx * 1.25, v * 1.25), off = .1;
      const symHi = c > 0 ? star((sx - off) * 1.2, (v - off) * 1.2) : ring((sx - off) * 1.25, (v - off) * 1.25);
      const shadeDish = u * .5 + v * .7;
      col = sym ? (symHi ? "l" : "h") : symHi ? "o" : shadeDish > .5 ? "d" : (shadeDish < -.2 && bay(x, y) > -.12) || (shadeDish < .1 && bay(x, y) > .25) ? "a" : "s";
    }
    g.set(x, y, col);
  }
  if (Math.abs(c) > .9) sparkle(g, 36, 11, 3); else if (Math.abs(c) > .55) sparkle(g, 36, 12, 1);
  return g;
}
export const COIN = [...Array(FRAMES)].map((_, i) => coin(i));
