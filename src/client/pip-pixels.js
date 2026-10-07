// pip as a PS1-style 3D sprite (tools/sprites/ps1). Six activities: wave, walk, juggle, read, hop and write.
import { SIZE, ACTIVITIES, sheet, accentName, drawFrame, frameCount, stepMs } from './sprite-player.js';

export function mascot(animated = false) {
  const canvas = document.createElement('canvas'); canvas.className = 'pip-mascot'; canvas.width = canvas.height = SIZE; canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d'), media = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0, loops = 0, activity = animated ? Math.floor(Math.random() * ACTIVITIES) : 0, timer = 0, disposed = false, accent = 'yellow';
  const still = () => !animated || media.matches;
  const draw = () => drawFrame(context, 'pip', accent, activity, still() ? 2 : frame);
  const tick = () => {
    timer = 0;
    if (disposed || !canvas.isConnected || document.hidden || still()) return;
    frame++;
    if (frame % frameCount('pip', activity) === 0 && ++loops >= 2) { loops = 0; frame = 0; activity = (activity + 1 + Math.floor(Math.random() * (ACTIVITIES - 1))) % ACTIVITIES; }
    draw(); timer = setTimeout(tick, stepMs('pip', activity));
  };
  const visibility = () => { clearTimeout(timer); timer = 0; if (disposed) return; draw(); if (!still() && !document.hidden) timer = setTimeout(tick, stepMs('pip', activity)); };
  canvas.dispose = () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); media.removeEventListener('change', visibility); };
  document.addEventListener('visibilitychange', visibility); media.addEventListener('change', visibility);
  requestAnimationFrame(() => { if (disposed) return; accent = accentName(canvas); sheet('pip', accent).then(visibility, () => {}); });
  return canvas;
}
