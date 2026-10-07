// pip's props: a book with a turning page, a notepad and pencil, and three juggling balls. All textures are tiny, like the PS1's.
import { box, ball, tube, chain, translate, rotX, rotY, rotZ, texture } from './raster.mjs';

const PAGE = box(.36, .46, .015, 'paper', { front: 'page' });
const LEAF = box(.36, .46, .012, 'paper', { front: 'leaf' });
const COVER = box(.8, .52, .03, 'cover');
const PAD = box(.56, .4, .03, 'cover', { front: 'pad' });
const PENCIL = tube(.028, .028, 0, .34, 'pencil', { sides: 5 });
const TIP = tube(.028, .004, -.07, 0, 'tip', { sides: 5, caps: false });
const BALL = ball(.13, .13, .13, 'ball-a', { slices: 7, stacks: 5 });

const paper = [.93, .93, .88, 1], rule = [.62, .63, .66, 1];
/** A page of text; the line being read is marked in the accent. */
function pageTexture(accent, line = -1) {
  const rows = [];
  for (let y = 0; y < 20; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const textRow = y >= 3 && y <= 17 && y % 2 === 1, k = (y - 3) >> 1, end = k % 3 === 2 ? 10 : 14;
      row += textRow && x >= 2 && x < end ? (k === line ? 'a' : 'r') : '.';
    }
    rows.push(row);
  }
  return texture(rows, { '.': paper, r: rule, a: [...accent, 1] });
}
/** The notepad: ruled lines, with ink written up to `progress` (0–1) in the accent colour. */
function padTexture(accent, progress = 0) {
  const W = 24, H = 18, rows = [], lines = [5, 9, 13], total = lines.length * 18;
  let ink = Math.round(progress * total);
  const inked = new Set();
  for (const y of lines) for (let x = 3; x < 21; x++) if (ink-- > 0) { const dy = (x * 7 + y) % 3 === 0 ? -1 : 0; inked.add((y + dy) * W + x); }
  for (let y = 0; y < H; y++) { let row = ''; for (let x = 0; x < W; x++) row += inked.has(y * W + x) ? 'a' : (x === 0 || x === W - 1 || y === 0 || y === H - 1) ? 'e' : lines.includes(y + 1) ? 'r' : '.'; rows.push(row); }
  return texture(rows, { '.': paper, r: rule, e: [.75, .75, .72, 1], a: [...accent.map(c => c * .55), 1] });
}
export function propMaterials(accent, prop = {}) {
  return {
    paper: { id: 20, color: paper.slice(0, 3) }, page: { id: 21, color: [1, 1, 1], tex: pageTexture(accent, prop.line ?? -1) }, leaf: { id: 22, color: [1, 1, 1], tex: pageTexture(accent, -1) },
    cover: { id: 23, color: accent.map(c => c * .5) }, pad: { id: 24, color: [1, 1, 1], tex: padTexture(accent, prop.progress || 0) },
    pencil: { id: 25, color: [1, .62, .22] }, tip: { id: 26, color: [.25, .22, .2] },
    'ball-a': { id: 27, color: accent }, 'ball-w': { id: 28, color: [.95, .95, .95] }, 'ball-o': { id: 29, color: [1, .55, .2] },
  };
}
const recolor = (mesh, mat) => ({ pos: mesh.pos, tris: mesh.tris.map(t => ({ ...t, mat })) });
const BALLS = [BALL, recolor(BALL, 'ball-w'), recolor(BALL, 'ball-o')];

/** Parts for a prop, placed in body space `R` (moves with pip). */
export function propParts(prop, R) {
  if (!prop || !prop.kind) return [];
  if (prop.kind === 'book') {
    const B = chain(R, translate(0, -.22, .48), rotX(-.55));
    const flip = prop.flip || 0, parts = [{ mesh: COVER, matrix: chain(B, translate(0, 0, -.03)), bias: -.4 }];
    parts.push({ mesh: PAGE, matrix: chain(B, rotY(.22), translate(-.19, 0, 0)), bias: -.1 }, { mesh: PAGE, matrix: chain(B, rotY(-.22), translate(.19, 0, 0)), bias: -.1 });
    if (flip > 0 && flip < 1) parts.push({ mesh: LEAF, matrix: chain(B, translate(0, 0, .01), rotY(-.22 - flip * (Math.PI - .44)), translate(.19, 0, 0)) });
    return parts;
  }
  if (prop.kind === 'pad') {
    const P = chain(R, translate(.02, -.26, .5), rotX(-.75));
    const x = -.2 + (prop.pen ?? 0) * .4, y = .1 - (prop.row ?? 0) * .1;
    const pen = chain(P, translate(x, y, .05), rotZ(-1.2), rotX(.75));
    return [{ mesh: PAD, matrix: P, bias: -.2 }, { mesh: PENCIL, matrix: pen, bias: .3 }, { mesh: TIP, matrix: pen, bias: .3 }];
  }
  if (prop.kind === 'juggle') {
    return [0, 1, 2].map(k => {
      const u = ((prop.phase || 0) + k / 3) % 1, a = u * Math.PI * 2;
      return { mesh: BALLS[k], matrix: chain(R, translate(Math.cos(a) * .6, .92 + Math.sin(a) * .3, .32 + Math.sin(a) * .1)) };
    });
  }
  return [];
}
