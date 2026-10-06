// pip, drawn as a 48-pixel sprite (see tools/sprites). Six little activities: wave, walk, juggle, read, hop and write.
import { loadSprites, spritesReady, frameImage, accentOf, framesOf, ACTIVITIES, STEP_MS } from './sprite-player.js';

export function mascot(animated = false) {
  const canvas = document.createElement('canvas'); canvas.className = 'pip-mascot'; canvas.width = canvas.height = 48; canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d'), media = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, loops = 0, activity = animated ? Math.floor(Math.random() * ACTIVITIES) : 0, timer = 0, disposed = false;
  const draw = () => {
    if (!spritesReady()) return;
    const frames = framesOf('pip', activity), still = !animated || media.matches;
    context.clearRect(0, 0, 48, 48);
    context.drawImage(frameImage(frames[still ? Math.min(2, frames.length - 1) : frame % frames.length], accentOf(canvas)), 0, 0);
  };
  const tick = () => {
    timer = 0;
    if (disposed || !canvas.isConnected || document.hidden || media.matches || !animated) return;
    frame++; if (frame % framesOf('pip', activity).length === 0 && ++loops >= 3) { loops = 0; activity = (activity + 1 + Math.floor(Math.random() * (ACTIVITIES - 1))) % ACTIVITIES; }
    draw(); timer = setTimeout(tick, STEP_MS.pip);
  };
  const visibility = () => { clearTimeout(timer); timer = 0; if (disposed) return; draw(); if (animated && !document.hidden && !media.matches) timer = setTimeout(tick, STEP_MS.pip); };
  canvas.dispose = () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', visibility); };
  document.addEventListener('visibilitychange', visibility); media.addEventListener('change', visibility);
  loadSprites().then(() => { if (!disposed) requestAnimationFrame(visibility); });
  return canvas;
}
