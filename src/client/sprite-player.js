// Plays the baked loading sprites (src/shared/sprites.js, drawn by tools/sprites). Frames are tinted from the accent colour.
let data = null, loading = null;
export const loadSprites = () => data ? Promise.resolve(data) : (loading ||= import('../shared/sprites.js').then(module => (data = module)));
export const spritesReady = () => data;

const cache = new Map();
function palette(accent) {
  const mul = k => accent.map(c => Math.round(c * k)), mix = k => accent.map(c => Math.round(c + (255 - c) * k));
  return { o: mul(.16), d: mul(.38), s: mul(.62), a: accent, l: mix(.38), h: mix(.75), G: [85, 88, 92], g: [141, 144, 148], w: [242, 242, 242], k: [5, 5, 5], t: mul(.09), u: mul(.17), Y: [140, 100, 50], y: [255, 191, 105], z: [255, 225, 175] };
}
/** "rgb(249, 245, 148)" or "#f9f594" → [249, 245, 148] */
export function accentOf(element) {
  const text = getComputedStyle(element).color, found = text.match(/\d+(\.\d+)?/g);
  return found && found.length >= 3 ? found.slice(0, 3).map(Number) : [0xf9, 0xf5, 0x94];
}
/** One frame as an offscreen canvas, tinted and cached. */
export function frameImage(rle, accent) {
  const key = accent.join(',') + ':' + rle;
  let canvas = cache.get(key);
  if (canvas) return canvas;
  const size = data.SPRITE_SIZE, colors = palette(accent);
  canvas = document.createElement('canvas'); canvas.width = canvas.height = size;
  const context = canvas.getContext('2d'), image = context.createImageData(size, size);
  let cell = 0;
  for (const [, count, letter] of rle.matchAll(/(\d+)(\D)/g)) {
    const rgb = colors[letter];
    for (let n = Number(count); n > 0; n--, cell++) if (rgb) { image.data[cell * 4] = rgb[0]; image.data[cell * 4 + 1] = rgb[1]; image.data[cell * 4 + 2] = rgb[2]; image.data[cell * 4 + 3] = 255; }
  }
  context.putImageData(image, 0, 0);
  if (cache.size > 160) cache.delete(cache.keys().next().value);
  cache.set(key, canvas);
  return canvas;
}
export const ACTIVITIES = 6; // wave, walk, juggle, read, hop, write; a seventh set (pull) is only used while pulling to refresh
export const PULL = 6;
export const STEP_MS = { pip: 110, cart: 70, coin: 80 };
/** The frames of a sprite family: 'pip' needs an activity, 'cart' and 'coin' do not. */
export function framesOf(kind, activity = 0) { return kind === 'pip' ? data.PIP[activity] : kind === 'cart' ? data.CART : data.COIN; }
