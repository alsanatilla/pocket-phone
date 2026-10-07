// A page that plays every animation large, for reviewing the sprites:  node tools/sprites/ps1/gallery.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { renderPip, ANIMATIONS, STEP_MS } from './pip3d.mjs';
import { saveFrame, SAVE_FRAMES } from './savescreen.mjs';
import { apng, upscale } from './apng.mjs';

const out = process.argv[2] || path.join(process.env.TEMP || '.', 'pip-gallery');
fs.mkdirSync(out, { recursive: true });
const K = 3, big = f => upscale(96, 96, f, K, [0, 0, 0]).rgba, items = [];
for (const [name, poses] of Object.entries(ANIMATIONS)) { apng(path.join(out, name + '.png'), 96 * K, 96 * K, poses.map(p => big(renderPip(p))), STEP_MS[name]); items.push(name); }
apng(path.join(out, 'save.png'), 96 * K, 96 * K, [...Array(SAVE_FRAMES)].map((_, i) => big(saveFrame(i))), 60); items.push('save');
fs.writeFileSync(path.join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>pip · sprites</title>
<style>body{background:#000;color:#aaa;font:14px ui-monospace,monospace;margin:32px}.grid{display:flex;flex-wrap:wrap;gap:28px}h2{color:#f9f594;font-weight:normal;font-size:15px;margin:0 0 8px}img{image-rendering:pixelated;display:block}</style>
<div class="grid">${items.map(n => `<div><h2>${n === 'save' ? 'sync · PS2 save screen' : n === 'pull' ? 'pull to refresh' : n}</h2><img src="${n}.png" width="288" height="288"></div>`).join('')}</div>`);
console.log(out);
