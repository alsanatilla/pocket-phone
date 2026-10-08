import { SIZE, ACTIVITIES, PULL, sheet, accentName, drawFrame, frameCount, stepMs } from './sprite-player.js';

const KINDS = ['pip', 'pip', 'save'];
/** The loader: pip (PS1) at one of his activities, or the PS2 memory-card save screen. Chosen at random each time. */
export function retroLoader(label = 'Loading Pocket') {
  const host = document.createElement('span'); host.className = 'retro-loading'; host.setAttribute('role', 'status'); host.setAttribute('aria-label', label);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE; canvas.setAttribute('aria-hidden', 'true'); host.append(canvas);
  const ctx = canvas.getContext('2d'), media = matchMedia('(prefers-reduced-motion: reduce)');
  let timer = 0, frame = 0, running = false, disposed = false, kind = 'pip', activity = 0, pulled = 0, accent = 'yellow';
  const pick = () => { kind = KINDS[Math.floor(Math.random() * KINDS.length)]; activity = Math.floor(Math.random() * ACTIVITIES); frame = 0; };
  pick();
  const draw = () => {
    if (!running && pulled > 0) { const n = frameCount('pip', PULL); return drawFrame(ctx, 'pip', accent, PULL, Math.min(n - 1, Math.floor(pulled * n))); }
    return drawFrame(ctx, kind, accent, activity, frame);
  };
  const stopped = () => disposed || !running || document.hidden || media.matches || document.documentElement.dataset.reduceMotion === 'true' || !host.isConnected;
  function tick() {
    timer = 0; if (stopped()) return;
    frame++; const length = frameCount(kind, activity);
    if (kind === 'pip' && frame % length === 0 && frame >= length * 2) { activity = (activity + 1 + Math.floor(Math.random() * (ACTIVITIES - 1))) % ACTIVITIES; frame = 0; }
    draw(); timer = setTimeout(tick, stepMs(kind, activity));
  }
  function resume() { clearTimeout(timer); timer = 0; draw(); if (!stopped()) timer = setTimeout(tick, stepMs(kind, activity)); }
  host.running = value => { if (value && !running) pick(); running = value; if (!value) pulled = 0; resume(); };
  host.pull = value => { if (!running) { pulled = Math.max(0, Math.min(.999, value)); draw(); } };
  host.dispose = () => { disposed = true; clearTimeout(timer); document.removeEventListener('visibilitychange', resume); media.removeEventListener('change', resume); };
  document.addEventListener('visibilitychange', resume); media.addEventListener('change', resume);
  requestAnimationFrame(() => { if (disposed) return; accent = accentName(host); Promise.all([sheet('pip', accent), sheet('save', accent)]).then(resume, () => {}); });
  return host;
}

export function installRefresh({ sync, status, onStatus, describe, say }) {
  const indicator = retroLoader('Syncing Pocket'); indicator.classList.add('refresh-indicator'); indicator.hidden = true; document.body.append(indicator);
  const GAP = 96;
  let x = 0, y = 0, eligible = false, distance = 0, dragging = false, delay = 0, manual = false;
  const scrollTop = () => document.scrollingElement?.scrollTop || 0;
  const topAt = target => { for (let p = target; p && p !== document.body; p = p.parentElement) if (p.scrollHeight > p.clientHeight + 2 && getComputedStyle(p).overflowY.match(/auto|scroll/) && p.scrollTop > 0) return false; return scrollTop() <= 0; };
  const reset = () => { distance = 0; dragging = false; document.getElementById('app').style.transform = ''; if (status.state !== 'syncing') { indicator.hidden = true; indicator.running(false); } };
  document.addEventListener('touchstart', e => { if (e.touches.length !== 1 || status.state === 'syncing') return; const t = e.touches[0]; x = t.clientX; y = t.clientY; eligible = topAt(e.target) && !e.target.closest('input,textarea,select,[contenteditable],canvas,.dialog,.travel-map-viewport'); dragging = false; }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (!eligible || e.touches.length !== 1) return;
    const t = e.touches[0], dx = t.clientX - x, dy = t.clientY - y;
    if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy)) { eligible = false; return; }
    if (dy > 18 && dy > Math.abs(dx) * 1.5 && topAt(e.target)) { dragging = true; e.preventDefault(); distance = Math.min(GAP * 1.35, dy * .55); indicator.hidden = false; indicator.pull(distance / GAP); document.getElementById('app').style.transform = `translateY(${distance}px)`; }
  }, { passive: false });
  const run = async () => { manual = true; indicator.hidden = false; indicator.running(true); try { const ok = await sync(); say(ok ? 'Synced' : describe()); } finally { manual = false; reset(); } };
  document.addEventListener('touchend', () => { const commit = dragging && distance >= GAP * .85; eligible = false; reset(); if (commit) run(); }, { passive: true });
  document.addEventListener('touchcancel', () => { eligible = false; reset(); }, { passive: true });
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') { e.preventDefault(); run(); } });
  onStatus(() => { clearTimeout(delay); if (status.state === 'syncing') delay = setTimeout(() => { indicator.hidden = false; indicator.running(true); }, manual ? 0 : 180); else reset(); });
  return run;
}
