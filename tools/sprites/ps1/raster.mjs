// A tiny software renderer with the PlayStation's habits: vertices snap to whole pixels (the wobble), textures are
// interpolated without perspective correction (the swim), triangles are painter-sorted rather than depth-buffered,
// and colour is truncated to 15 bits through the console's 4×4 dither.

// ── Math: row-major 4×4 matrices ──
export const ident = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
export function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
  return o;
}
export const translate = (x, y, z) => [1,0,0,x, 0,1,0,y, 0,0,1,z, 0,0,0,1];
export const scale = (x, y = x, z = x) => [x,0,0,0, 0,y,0,0, 0,0,z,0, 0,0,0,1];
export const rotX = a => { const c = Math.cos(a), s = Math.sin(a); return [1,0,0,0, 0,c,-s,0, 0,s,c,0, 0,0,0,1]; };
export const rotY = a => { const c = Math.cos(a), s = Math.sin(a); return [c,0,s,0, 0,1,0,0, -s,0,c,0, 0,0,0,1]; };
export const rotZ = a => { const c = Math.cos(a), s = Math.sin(a); return [c,-s,0,0, s,c,0,0, 0,0,1,0, 0,0,0,1]; };
export const chain = (...ms) => ms.reduce((a, b) => mul(a, b), ident());
const point = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]];
const dir = (m, [x, y, z]) => [m[0] * x + m[1] * y + m[2] * z, m[4] * x + m[5] * y + m[6] * z, m[8] * x + m[9] * y + m[10] * z];
export const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// ── Meshes: {pos: [[x,y,z]], tris: [{v:[i,j,k], uv:[[u,v]x3]|null, n:[[nx,ny,nz]x3], mat}]} ──
export function mesh() { return { pos: [], tris: [] }; }
function faceNormal(a, b, c) { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; return norm([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]); }
function addTri(m, a, b, c, mat, uv = null, normals = null) {
  // Wind every triangle so it faces the way its normals point (outward), whatever order it was given in.
  const f = faceNormal(a, b, c);
  if (normals && dot(f, normals[0]) + dot(f, normals[1]) + dot(f, normals[2]) < 0) { [b, c] = [c, b]; if (uv) uv = [uv[0], uv[2], uv[1]]; normals = [normals[0], normals[2], normals[1]]; }
  const i = m.pos.length; m.pos.push(a, b, c);
  const n = normals || [f, f, f];
  m.tris.push({ v: [i, i + 1, i + 2], uv, n, mat });
}

/** A rounded-rectangle slab: flat front and back caps, a smoothly shaded rim. The front cap carries the texture. */
export function slab(w, h, d, r, mat, { seg = 3, frontMat = mat, backMat = mat } = {}) {
  const m = mesh(), ring = [];
  const corners = [[w / 2 - r, h / 2 - r, 0], [-(w / 2 - r), h / 2 - r, Math.PI / 2], [-(w / 2 - r), -(h / 2 - r), Math.PI], [w / 2 - r, -(h / 2 - r), Math.PI * 1.5]];
  for (const [cx, cy, a0] of corners) for (let k = 0; k <= seg; k++) { const a = a0 + k / seg * Math.PI / 2; ring.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, Math.cos(a), Math.sin(a)]); }
  const uv = (x, y) => [x / w + .5, .5 - y / h];
  const zf = d / 2, zb = -d / 2;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    addTri(m, [0, 0, zf], [a[0], a[1], zf], [b[0], b[1], zf], frontMat, [uv(0, 0), uv(a[0], a[1]), uv(b[0], b[1])], [[0, 0, 1], [0, 0, 1], [0, 0, 1]]);
    const ub = (x, y) => [.5 - x / w, .5 - y / h];
    addTri(m, [0, 0, zb], [b[0], b[1], zb], [a[0], a[1], zb], backMat, [ub(0, 0), ub(b[0], b[1]), ub(a[0], a[1])], [[0, 0, -1], [0, 0, -1], [0, 0, -1]]);
    const na = [a[2], a[3], 0], nb = [b[2], b[3], 0];
    addTri(m, [a[0], a[1], zf], [a[0], a[1], zb], [b[0], b[1], zb], mat, null, [na, na, nb]);
    addTri(m, [a[0], a[1], zf], [b[0], b[1], zb], [b[0], b[1], zf], mat, null, [na, nb, nb]);
  }
  return m;
}
/** A low-poly ellipsoid with smooth normals. */
export function ball(rx, ry, rz, mat, { slices = 8, stacks = 5 } = {}) {
  const m = mesh(), p = (i, j) => { const t = i / stacks * Math.PI, f = j / slices * Math.PI * 2; const n = [Math.sin(t) * Math.cos(f), Math.cos(t), Math.sin(t) * Math.sin(f)]; return { v: [n[0] * rx, n[1] * ry, n[2] * rz], n: norm([n[0] / rx, n[1] / ry, n[2] / rz]) }; };
  for (let i = 0; i < stacks; i++) for (let j = 0; j < slices; j++) {
    const a = p(i, j), b = p(i + 1, j), c = p(i + 1, j + 1), d = p(i, j + 1);
    if (i < stacks - 1) addTri(m, a.v, c.v, b.v, mat, null, [a.n, c.n, b.n]);
    if (i > 0) addTri(m, a.v, d.v, c.v, mat, null, [a.n, d.n, c.n]);
  }
  return m;
}
/** A cylinder along Y from y0 to y1, with caps. */
export function tube(r0, r1, y0, y1, mat, { sides = 6, caps = true } = {}) {
  const m = mesh();
  for (let k = 0; k < sides; k++) {
    const a = k / sides * Math.PI * 2, b = (k + 1) / sides * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    const A0 = [ca * r0, y0, sa * r0], B0 = [cb * r0, y0, sb * r0], A1 = [ca * r1, y1, sa * r1], B1 = [cb * r1, y1, sb * r1], na = [ca, 0, sa], nb = [cb, 0, sb];
    addTri(m, A0, B1, B0, mat, null, [na, nb, nb]); addTri(m, A0, A1, B1, mat, null, [na, na, nb]);
    if (caps) { addTri(m, [0, y1, 0], B1, A1, mat, null, [[0, 1, 0], [0, 1, 0], [0, 1, 0]]); addTri(m, [0, y0, 0], A0, B0, mat, null, [[0, -1, 0], [0, -1, 0], [0, -1, 0]]); }
  }
  return m;
}
/** A box with flat faces. */
export function box(w, h, d, mat, faceMats = {}) {
  const m = mesh(), x = w / 2, y = h / 2, z = d / 2;
  const quad = (a, b, c, e, mt, uvq = null) => { addTri(m, a, b, c, mt, uvq && [uvq[0], uvq[1], uvq[2]]); addTri(m, a, c, e, mt, uvq && [uvq[0], uvq[2], uvq[3]]); };
  const UV = [[0, 1], [1, 1], [1, 0], [0, 0]];
  quad([-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z], faceMats.front || mat, faceMats.front ? UV : null);
  quad([x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z], faceMats.back || mat);
  quad([-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z], faceMats.top || mat);
  quad([-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], mat);
  quad([x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z], mat);
  quad([-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z], mat);
  return m;
}

// ── Scene rendering ──
const DITHER = [[-4, 0, -3, 1], [2, -2, 3, -1], [-3, 1, -4, 0], [3, -1, 2, -2]];
export function makeTarget(w, h) { return { w, h, rgba: new Float32Array(w * h * 4), mat: new Int16Array(w * h).fill(-1) }; }

/**
 * Draws parts: [{mesh, matrix}] seen by a camera. Materials: {color:[r,g,b] 0..1, tex?:{w,h,px:[[r,g,b,a]]}, emissive?:0..1, tint?:'accent'}.
 * Lights: {ambient:[r,g,b], dirs:[{dir:[x,y,z], color:[r,g,b]}]}. `snap` turns the PS1 vertex jitter on.
 */
export function render(target, parts, { camera, materials, lights, snap = true, fog = null, cull = true }) {
  const { w, h } = target, tris = [];
  const view = camera.view, f = 1 / Math.tan(camera.fov / 2);
  for (const { mesh: m, matrix, bias = 0 } of parts) {
    const mv = mul(view, matrix);
    for (const t of m.tris) {
      const V = t.v.map(i => point(mv, m.pos[i])), N = t.n.map(n => norm(dir(matrix, n)));
      if (V.some(v => v[2] > -.05)) continue;
      const S = V.map(([x, y, z]) => { const sx = w / 2 + x * f / -z * w / 2, sy = h / 2 - y * f / -z * w / 2; return snap ? [Math.round(sx), Math.round(sy), z] : [sx, sy, z]; });
      const area = (S[1][0] - S[0][0]) * (S[2][1] - S[0][1]) - (S[2][0] - S[0][0]) * (S[1][1] - S[0][1]);
      if (cull && area >= 0) continue;
      const mat = materials[t.mat];
      // Gouraud: light each vertex; the PS1 modulates texture by vertex colour with 2× headroom.
      const C = N.map(n => {
        if (mat.emissive >= 1) return [1, 1, 1];
        let c = [...lights.ambient];
        for (const L of lights.dirs) {
          const l = norm(L.dir), k = Math.max(0, dot(n, l)); c = c.map((x, i) => x + L.color[i] * k);
          // glossy materials get a Blinn highlight, seen from the front (the camera sits near +z)
          if (mat.spec && k > 0) { const s = mat.spec[0] * Math.pow(Math.max(0, dot(n, norm([l[0], l[1], l[2] + 1]))), mat.spec[1]); c = c.map((x, i) => x + L.color[i] * s); }
        }
        return c.map(x => Math.min(2, x * (1 - (mat.emissive || 0)) + (mat.emissive || 0)));
      });
      tris.push({ S, C, uv: t.uv, mat: t.mat, z: (V[0][2] + V[1][2] + V[2][2]) / 3 + bias }); // bias: hand-tuned order, as PS1 games did
    }
  }
  tris.sort((a, b) => a.z - b.z); // farthest first, like the ordering table
  for (const t of tris) raster(target, t, materials[t.mat], fog);
}

function raster(target, t, mat, fog) {
  const { w, h, rgba } = target, [A, B, C] = t.S;
  const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))), maxX = Math.min(w - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
  const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))), maxY = Math.min(h - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
  const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
  if (Math.abs(area) < 1e-6) return;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + .5, py = y + .5;
    const w0 = ((B[0] - px) * (C[1] - py) - (C[0] - px) * (B[1] - py)) / area, w1 = ((C[0] - px) * (A[1] - py) - (A[0] - px) * (C[1] - py)) / area, w2 = 1 - w0 - w1;
    if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
    // affine: screen-space weights, no perspective division (the PS1's texture swim)
    let col = mat.color.slice(), alpha = 1;
    if (mat.tex && t.uv) {
      const u = t.uv[0][0] * w0 + t.uv[1][0] * w1 + t.uv[2][0] * w2, v = t.uv[0][1] * w0 + t.uv[1][1] * w1 + t.uv[2][1] * w2;
      const tx = Math.min(mat.tex.w - 1, Math.max(0, Math.floor(u * mat.tex.w))), ty = Math.min(mat.tex.h - 1, Math.max(0, Math.floor(v * mat.tex.h)));
      const texel = mat.tex.px[ty * mat.tex.w + tx];
      if (texel[3] === 0) continue;
      col = texel.slice(0, 3);
      // glowing texels (eyes, screen light) ignore the lights
      if (texel[4]) { const i = (y * w + x) * 4; rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = 1; target.mat[y * w + x] = 99; continue; }
    }
    const light = [0, 1, 2].map(k => t.C[0][k] * w0 + t.C[1][k] * w1 + t.C[2][k] * w2);
    col = col.map((c, k) => c * light[k]);
    if (fog) { const z = -(t.S[0][2] * w0 + t.S[1][2] * w1 + t.S[2][2] * w2), k = Math.min(1, Math.max(0, (z - fog.near) / (fog.far - fog.near))); col = col.map((c, i) => c + (fog.color[i] - c) * k); }
    const i = (y * w + x) * 4; rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = alpha; target.mat[y * w + x] = mat.id ?? 0;
  }
}

/** 15-bit colour through the PS1 dither: 8-bit value + matrix offset, truncated to 5 bits. */
export function ps1Quantize(target) {
  const { w, h, rgba } = target, out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; if (rgba[i + 3] <= 0) continue;
    for (let k = 0; k < 3; k++) { const v = Math.max(0, Math.min(255, Math.round(rgba[i + k] * 255) + DITHER[y & 3][x & 3])) >> 3; out[i + k] = v << 3 | v >> 2; }
    out[i + 3] = Math.round(Math.min(1, rgba[i + 3]) * 255);
  }
  return out;
}
/** A look-at camera. */
export function camera({ eye, at = [0, 0, 0], fov = .7 }) {
  const fwd = norm([at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]]);
  const r = norm([-fwd[2], 0, fwd[0]]), up = [r[1] * fwd[2] - r[2] * fwd[1], r[2] * fwd[0] - r[0] * fwd[2], r[0] * fwd[1] - r[1] * fwd[0]];
  const view = [r[0], r[1], r[2], -dot(r, eye), up[0], up[1], up[2], -dot(up, eye), -fwd[0], -fwd[1], -fwd[2], dot(fwd, eye), 0, 0, 0, 1];
  return { view, fov };
}
/** Hand-drawn texture from rows of letters and a letter → colour key. */
export function texture(rows, key) {
  const h = rows.length, w = rows[0].length, px = [];
  for (const row of rows) for (const ch of row) px.push(key[ch] || [0, 0, 0, 0]);
  return { w, h, px };
}
