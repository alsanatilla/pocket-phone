// Plays pip (PS1-style) and the save-screen loader (PS2-style) from the sheets in /sprites, drawn by tools/sprites/ps1.
import { SPRITE_SIZE, PIP_FRAMES, PIP_STEP_MS, PIP_COLS, SAVE_FRAMES, SAVE_COLS, SAVE_STEP_MS, ACCENTS } from '../shared/sprites.js';

export const SIZE = SPRITE_SIZE;
export const ACTIVITIES = 6;   // wave, walk, juggle, read, hop, write
export const PULL = 6;         // the crouch used while pulling to refresh
const sheets = new Map();

/** The baked accent closest to the element's current accent colour. */
export function accentName(element) {
  const found = getComputedStyle(element).color.match(/\d+(\.\d+)?/g)?.slice(0, 3).map(Number) || [249, 245, 148];
  let best = 'yellow', distance = Infinity;
  for (const [name, hex] of Object.entries(ACCENTS)) {
    const v = parseInt(hex.slice(1), 16), d = (found[0] - (v >> 16 & 255)) ** 2 + (found[1] - (v >> 8 & 255)) ** 2 + (found[2] - (v & 255)) ** 2;
    if (d < distance) { distance = d; best = name; }
  }
  return best;
}
/** Loads (once) the sheet for a kind and accent; resolves to the image. */
export function sheet(kind, accent) {
  const key = kind + '-' + accent;
  if (!sheets.has(key)) sheets.set(key, new Promise((resolve, reject) => { const image = new Image(); image.decoding = 'async'; image.onload = () => resolve(image); image.onerror = reject; image.src = `/sprites/${key}.png`; }).then(image => (sheets.set(key, image), image)));
  const value = sheets.get(key);
  return value instanceof Image ? Promise.resolve(value) : value;
}
export const ready = (kind, accent) => { const value = sheets.get(kind + '-' + accent); return value instanceof Image ? value : null; };
export const frameCount = (kind, activity = 0) => kind === 'save' ? SAVE_FRAMES : PIP_FRAMES[activity];
export const stepMs = (kind, activity = 0) => kind === 'save' ? SAVE_STEP_MS : PIP_STEP_MS[activity];

/** Draws one frame; returns false while the sheet is still loading. */
export function drawFrame(context, kind, accent, activity, frame) {
  const image = ready(kind, accent); if (!image) return false;
  const index = kind === 'save' ? frame % SAVE_FRAMES : activity * PIP_COLS + frame % PIP_FRAMES[activity], cols = kind === 'save' ? SAVE_COLS : PIP_COLS;
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, SIZE, SIZE);
  context.drawImage(image, (index % cols) * SIZE, Math.floor(index / cols) * SIZE, SIZE, SIZE, 0, 0, SIZE, SIZE);
  return true;
}
