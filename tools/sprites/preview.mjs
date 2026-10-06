import fs from 'node:fs';
import zlib from 'node:zlib';
import { N } from './lib.mjs';

const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = b => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };

/** Letter → colour. The apps rebuild exactly this from the accent at run time. */
export function palette(accent) {
  const mul = k => accent.map(c => Math.round(c * k)), mix = k => accent.map(c => Math.round(c + (255 - c) * k));
  return { o: mul(.16), d: mul(.38), s: mul(.62), a: accent, l: mix(.38), h: mix(.75), G: [85, 88, 92], g: [141, 144, 148], w: [242, 242, 242], k: [5, 5, 5], t: mul(.09), u: mul(.17), Y: [140, 100, 50], y: [255, 191, 105], z: [255, 225, 175] };
}
export function sheet(file, grids, { cols = 8, scale = 3, accent = [0xf9, 0xf5, 0x94], bg = [0, 0, 0] } = {}) {
  const pal = palette(accent), rows = Math.ceil(grids.length / cols), W = cols * (N + 2) * scale, H = rows * (N + 2) * scale, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const gx = Math.floor(x / scale), gy = Math.floor(y / scale), cell = Math.floor(gx / (N + 2)), row = Math.floor(gy / (N + 2)), px = gx % (N + 2) - 1, py = gy % (N + 2) - 1;
    let col = [26, 0, 0];
    const g = grids[row * cols + cell];
    if (g && px >= 0 && py >= 0 && px < N && py < N) { const c = g.get(px, py); col = c === '.' ? bg : pal[c] || [255, 0, 255]; }
    raw.set(col, y * (W * 3 + 1) + 1 + x * 3);
  }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
