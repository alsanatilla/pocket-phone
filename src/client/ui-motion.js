import { storage } from './workspace-storage.js';

export const EASE_OUT = 'cubic-bezier(.23, 1, .32, 1)';
export function motionOff() {
  try { if (JSON.parse(storage.getItem('pocket:appearance') || '{}').reduceMotion) return true; } catch {}
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
}

const rolls = new WeakMap();
/** A live reading may change again before its first transition ends. Always land on the latest value. */
export function rollText(node, text) {
  text = String(text);
  const old = rolls.get(node);
  if (motionOff() || !node.animate) {
    old?.animation.cancel(); rolls.delete(node); node.textContent = text; return;
  }
  if (old?.leaving) { old.next = text; return; }
  if (node.textContent === text) return;
  old?.animation.cancel();
  const state = { next: text, leaving: true };
  state.animation = node.animate([{ transform: 'none', opacity: 1 }, { transform: 'translateY(-8px)', opacity: 0 }], { duration: 90, easing: EASE_OUT, fill: 'forwards' });
  rolls.set(node, state);
  state.animation.onfinish = () => {
    node.textContent = state.next; state.animation.cancel(); state.leaving = false;
    if (!node.isConnected || motionOff()) { rolls.delete(node); return; }
    state.animation = node.animate([{ transform: 'translateY(8px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: EASE_OUT });
    state.animation.onfinish = () => { if (rolls.get(node) === state) rolls.delete(node); };
  };
}

/** Touch scrolling cancels press feedback; keyboard activation never tilts the control. */
export function pressMotion(node, tilt = false) {
  let timer = 0, origin = null;
  const release = () => { clearTimeout(timer); origin = null; node.classList.remove('pressed'); node.style.removeProperty('--rx'); node.style.removeProperty('--ry'); };
  node.addEventListener('pointerdown', event => {
    if (motionOff() || event.button > 0 || node.disabled) return;
    origin = { x: event.clientX, y: event.clientY };
    const box = node.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
    const press = () => {
      if (motionOff() || !origin) return;
      if (tilt) { node.style.setProperty('--ry', (x * 6).toFixed(2) + 'deg'); node.style.setProperty('--rx', (-y * 6).toFixed(2) + 'deg'); }
      node.classList.add('pressed');
    };
    clearTimeout(timer); if (event.pointerType === 'touch') timer = setTimeout(press, 60); else press();
  });
  node.addEventListener('pointermove', event => { if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8) release(); });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave', 'lostpointercapture', 'blur']) node.addEventListener(type, release);
  return release;
}

export function enter(node, delay = 0) {
  if (motionOff() || !node.animate) return;
  node.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, delay, easing: EASE_OUT, fill: 'backwards' });
}
