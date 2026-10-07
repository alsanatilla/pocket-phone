import { renderPip, HOP, WAVE } from './pip3d.mjs';
import { apng, png, upscale, sheet } from './apng.mjs';

const out = 'C:/Users/alsana/AppData/Local/Temp/shots/';
const S = 96, K = 3, BG = [0, 0, 0];
for (const [name, poses, ms] of [['hop', HOP, 85], ['wave', WAVE, 95]]) {
  const frames = poses.map(p => renderPip(p));
  apng(out + 'ps1-' + name + '.png', S * K, S * K, frames.map(f => upscale(S, S, f, K, BG).rgba), ms);
  const sh = sheet(frames, S, S, 6);
  const big = upscale(sh.w, sh.h, sh.rgba, 2);
  png(out + 'ps1-' + name + '-sheet.png', big.w, big.h, big.rgba);
}
console.log('ok');
import { saveFrame, SAVE_FRAMES } from './savescreen.mjs';
const saves = [...Array(SAVE_FRAMES)].map((_, i) => saveFrame(i));
apng(out + 'ps2-save.png', S * K, S * K, saves.map(f => upscale(S, S, f, K, BG).rgba), 60);
const ss = sheet(saves.filter((_, i) => i % 4 === 0), S, S, 4), sb = upscale(ss.w, ss.h, ss.rgba, 2);
png(out + 'ps2-save-sheet.png', sb.w, sb.h, sb.rgba);
console.log('save ok');
