import { getPhoto } from "./zine-store.js?v=20261006-movement1";

export const PAGE_WIDTH = 298, PAGE_HEIGHT = 420;
export const pageCount = book => book.photos.length + 2;
const canvas = (width, height) => Object.assign(document.createElement("canvas"), { width, height });
const blobFrom = (surface, type = "image/jpeg", quality = .9) => new Promise((resolve, reject) => {
  surface.toBlob(blob => blob ? resolve(blob) : reject(new Error("Couldn't prepare that image.")), type, quality);
});
async function imageFrom(blob) {
  const url = URL.createObjectURL(blob), image = new Image();
  try {
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("This image couldn't be opened. Try a JPEG, PNG or WebP photo."));
      image.src = url;
    });
    return image;
  } finally { URL.revokeObjectURL(url); }
}
export async function preparePhoto(file) {
  if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} is over 30 MB. Choose a smaller copy.`);
  const image = await imageFrom(file);
  const ratio = Math.min(1, 2000 / Math.max(image.naturalWidth, image.naturalHeight));
  const surface = canvas(Math.max(1, Math.round(image.naturalWidth * ratio)), Math.max(1, Math.round(image.naturalHeight * ratio)));
  const ctx = surface.getContext("2d");
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, surface.width, surface.height);
  ctx.drawImage(image, 0, 0, surface.width, surface.height);
  const source = await blobFrom(surface);
  const scale = Math.min(1, 240 / Math.max(surface.width, surface.height));
  const thumb = canvas(Math.max(1, Math.round(surface.width * scale)), Math.max(1, Math.round(surface.height * scale)));
  thumb.getContext("2d").drawImage(surface, 0, 0, thumb.width, thumb.height);
  return { id: crypto.randomUUID(), name: file.name, source, thumbnail: await blobFrom(thumb, "image/jpeg", .8) };
}

// Smooth silver tones are the default: a dark book still needs readable photos.
// Photocopy grain and threshold ink are explicit alternatives. Stored photos
// remain intact, so changing a treatment is reversible.
export function monochrome(data, width, height, tone) {
  if (tone !== "grain" && tone !== "ink") {
    for (let i = 0; i < data.length; i += 4) {
      let light = (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) / 256;
      if (tone !== "soft") light = 255 * Math.pow(light / 255, 1.08);
      const gray = Math.round(light);
      data[i] = data[i + 1] = data[i + 2] = gray; data[i + 3] = 255;
    }
    return;
  }
  let current = new Float32Array(width + 2), next = new Float32Array(width + 2);
  for (let y = 0; y < height; y++) {
    const direction = y % 2 ? -1 : 1;
    for (let x = direction === 1 ? 0 : width - 1; x >= 0 && x < width; x += direction) {
      const i = (y * width + x) * 4;
      let light = (data[i] * 54 + data[i + 1] * 183 + data[i + 2] * 19) / 256;
      light = 255 * Math.pow(light / 255, 1.08);
      const value = light + (tone === "ink" ? 0 : current[x + 1]);
      const printed = value >= 128 ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = printed; data[i + 3] = 255;
      if (tone !== "ink") {
        const error = value - printed;
        current[x + 1 + direction] += error * 7 / 16;
        next[x + 1 - direction] += error * 3 / 16;
        next[x + 1] += error * 5 / 16;
        next[x + 1 + direction] += error / 16;
      }
    }
    [current, next] = [next, current]; next.fill(0);
  }
}

export function renderer() {
  const cache = new Map();
  async function photo(id, tone) {
    const key = id + ":" + tone;
    if (cache.has(key)) return cache.get(key);
    const record = await getPhoto(id);
    if (!record) throw new Error("A photo is missing from this browser. Add it again to repair the zine.");
    const image = await imageFrom(record.source);
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const surface = canvas(Math.max(1, Math.round(image.naturalWidth * scale)), Math.max(1, Math.round(image.naturalHeight * scale)));
    const ctx = surface.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, surface.width, surface.height);
    const pixels = ctx.getImageData(0, 0, surface.width, surface.height);
    monochrome(pixels.data, surface.width, surface.height, tone);
    ctx.putImageData(pixels, 0, 0);
    cache.set(key, surface);
    while (cache.size > 3) cache.delete(cache.keys().next().value);
    return surface;
  }
  return {
    clear: () => cache.clear(),
    async page(book, index, scale = 2) {
      const surface = canvas(Math.round(PAGE_WIDTH * scale), Math.round(PAGE_HEIGHT * scale));
      const ctx = surface.getContext("2d");
      ctx.scale(scale, scale); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      if (index == null) return surface;
      await Promise.all([document.fonts.load('34px "Jacquard 24"'), document.fonts.load('20px "VT323"')]);
      ctx.fillStyle = "#fff";
      const text = (value, x, y, size = 8, family = "monospace") => {
        ctx.font = `${size}px ${family}`; ctx.fillText(value, x, y, PAGE_WIDTH - x - 18);
      };
      const draw = (image, x, y, width, height, crop = false) => {
        const ratio = crop ? Math.max(width / image.width, height / image.height) : Math.min(width / image.width, height / image.height);
        const w = image.width * ratio, h = image.height * ratio;
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, width, height); ctx.clip();
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h); ctx.restore();
      };
      if (index === 0) {
        if (book.photos.length) draw(await photo(book.photos[0].id, book.tone), 18, 44, 262, 245);
        const title = book.title.trim() || "untitled";
        ctx.font = '34px "Jacquard 24"';
        let size = 34;
        let lines = wrap(ctx, title, 262);
        while (lines.length > 3 && size > 14) { size -= 2; ctx.font = `${size}px "Jacquard 24"`; lines = wrap(ctx, title, 262); }
        lines.slice(0, 3).forEach((line, i) => text(line, 18, 326 + i * (size + 1), size, '"Jacquard 24"'));
        text(book.byline.trim(), 18, 405);
      } else if (index === pageCount(book) - 1) {
        text("pocket", 18, 322, 48, '"Jacquard 24"');
        text(book.title.trim() || "untitled", 18, 344);
        text(`${book.photos.length} photograph${book.photos.length === 1 ? "" : "s"} / ${new Date(book.created).getFullYear()}`, 18, 393);
      } else {
        const entry = book.photos[index - 1], image = await photo(entry.id, book.tone);
        const bleed = entry.layout === "bleed";
        draw(image, bleed ? 0 : 18, bleed ? 0 : 44, bleed ? PAGE_WIDTH : 262, bleed ? 374 : 318, bleed);
        ctx.fillStyle = "#fff";
        if (!bleed) text(book.title.trim() || "untitled", 18, 24);
        ctx.font = "8px monospace";
        wrap(ctx, entry.caption, 262).slice(0, 2).forEach((line, i) => text(line, 18, 390 + i * 10));
        const number = String(index).padStart(2, "0");
        text(number, PAGE_WIDTH - 18 - ctx.measureText(number).width, 412, 7);
      }
      return surface;
    }
  };
}
function wrap(ctx, value, width) {
  const lines = [];
  for (const paragraph of value.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + " " + word : word;
      if (ctx.measureText(candidate).width <= width) { line = candidate; continue; }
      if (line) lines.push(line);
      line = "";
      for (const char of word) {
        if (line && ctx.measureText(line + char).width > width) { lines.push(line); line = ""; }
        line += char;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}
