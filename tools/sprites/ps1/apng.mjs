// Animated PNG writer (and a still PNG helper), so previews play in any browser.
import fs from 'node:fs';
import zlib from 'node:zlib';

const T = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const u16 = v => { const b = Buffer.alloc(2); b.writeUInt16BE(v); return b; };
const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([u32(data.length), td, u32(crc(td))]); };
const raw = (w, h, rgba) => { const out = Buffer.alloc((w * 4 + 1) * h); for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(out, y * (w * 4 + 1) + 1); return zlib.deflateSync(out, { level: 9 }); };
const ihdr = (w, h) => chunk('IHDR', Buffer.concat([u32(w), u32(h), Buffer.from([8, 6, 0, 0, 0])]));
const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** Nearest-neighbour upscale with an optional background colour behind transparent pixels. */
export function upscale(w, h, rgba, k, bg = null) {
  const W = w * k, H = h * k, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const s = ((y / k | 0) * w + (x / k | 0)) * 4, d = (y * W + x) * 4, a = rgba[s + 3] / 255;
    if (bg) { for (let c = 0; c < 3; c++) out[d + c] = rgba[s + c] * a + bg[c] * (1 - a); out[d + 3] = 255; }
    else for (let c = 0; c < 4; c++) out[d + c] = rgba[s + c];
  }
  return { w: W, h: H, rgba: out };
}
export function png(file, w, h, rgba) { fs.writeFileSync(file, Buffer.concat([SIG, ihdr(w, h), chunk('IDAT', raw(w, h, rgba)), chunk('IEND', Buffer.alloc(0))])); }
export function apng(file, w, h, frames, delayMs) {
  const parts = [SIG, ihdr(w, h), chunk('acTL', Buffer.concat([u32(frames.length), u32(0)]))];
  let seq = 0;
  frames.forEach((rgba, i) => {
    parts.push(chunk('fcTL', Buffer.concat([u32(seq++), u32(w), u32(h), u32(0), u32(0), u16(delayMs), u16(1000), Buffer.from([1, 0])])));
    const data = raw(w, h, rgba);
    parts.push(i === 0 ? chunk('IDAT', data) : chunk('fdAT', Buffer.concat([u32(seq++), data])));
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  fs.writeFileSync(file, Buffer.concat(parts));
}
/** Frames side by side in rows, for a contact sheet. */
export function sheet(frames, w, h, cols, gap = 4, bg = [0, 0, 0]) {
  const rows = Math.ceil(frames.length / cols), W = cols * (w + gap) + gap, H = rows * (h + gap) + gap, out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = 40; out[i * 4 + 1] = 10; out[i * 4 + 2] = 10; out[i * 4 + 3] = 255; }
  frames.forEach((f, n) => { const ox = gap + (n % cols) * (w + gap), oy = gap + Math.floor(n / cols) * (h + gap);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, d = ((oy + y) * W + ox + x) * 4, a = f[s + 3] / 255; for (let c = 0; c < 3; c++) out[d + c] = f[s + c] * a + bg[c] * (1 - a); out[d + 3] = 255; } });
  return { w: W, h: H, rgba: out };
}
