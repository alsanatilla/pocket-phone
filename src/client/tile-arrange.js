import { arranged, dropIndex, snapSize } from './tile-layout.js';

// Arranging the Today tiles in the browser: hold one to pick it up, drag it to another slot, drag its corner to
// resize it, tap its badge to unpin it, or tap the empty board to stop. The gestures match the phone's board and
// the packing maths is the same (tile-layout.js / TileLayout.java).
const HOLD = 350, BADGE = 34, HANDLE = 34;
const SPAN = { small: [1, 1], square: [2, 2], wide: [4, 2] };

export function arrangeTiles(board, { list, save, size, changed = () => {} }) {
  let mode = false, hold = 0, tile = null, kind = '', order = [], sizes = new Map(), grab = null, offset = null;
  let moved = false, resizing = false, suppress = false;

  const announce = () => board.dispatchEvent(new CustomEvent('tile-arrange', { detail: { on: mode }, bubbles: true }));
  const nodes = () => [...board.querySelectorAll('.live-tile')];
  const nodeOf = value => board.querySelector(`[data-tile="${value}"]`);
  const read = () => { const value = list(); order = value.map(item => item.kind); sizes = new Map(value.map(item => [item.kind, size(item)])); };
  const metrics = () => {
    const style = getComputedStyle(board), gap = parseFloat(style.columnGap) || 8;
    const columns = style.gridTemplateColumns.split(' ').filter(Boolean).length || 4, box = board.getBoundingClientRect();
    return { unit: (box.width - gap * (columns - 1)) / columns, rowUnit: parseFloat(style.gridAutoRows) || 0, gap, columns, box };
  };
  const boxes = () => nodes().map(node => [node, node.getBoundingClientRect()]);
  /** The tiles that are not moving slide from where they were, so a reorder or resize reads as movement. */
  const flip = before => {
    for (const [node, box] of before) {
      if (node === tile || !node.isConnected) continue;
      const now = node.getBoundingClientRect(), dx = box.left - now.left, dy = box.top - now.top;
      if (!dx && !dy) continue;
      node.style.transition = 'none'; node.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => { node.style.transition = ''; node.style.transform = ''; });
    }
  };
  const place = next => { order = next; board.append(...order.map(nodeOf).filter(Boolean)); };
  /** Holds the lifted tile under the finger: the grid reflows underneath it when the order changes. */
  const follow = event => {
    tile.style.transform = 'none';
    const slot = tile.getBoundingClientRect();
    tile.style.transform = `translate(${event.clientX - offset.x - slot.left}px, ${event.clientY - offset.y - slot.top}px) scale(1.04)`;
  };
  const pick = (node, event) => {
    tile = node; kind = node.dataset.tile; resizing = false; moved = false;
    grab = { x: event.clientX, y: event.clientY };
    const box = node.getBoundingClientRect();
    offset = { x: event.clientX - box.left, y: event.clientY - box.top };
    if (offset.x > box.width - HANDLE && offset.y > box.height - HANDLE) resizing = true;
    else node.classList.add('dragging');
    board.setPointerCapture?.(event.pointerId);
  };
  const drag = event => {
    const { unit, rowUnit, gap, columns, box } = metrics();
    const dx = event.clientX - grab.x, dy = event.clientY - grab.y;
    moved = moved || Math.hypot(dx, dy) > 4;
    if (resizing) {
      const [cols, rows] = SPAN[sizes.get(kind)] || SPAN.square;
      const width = cols * unit + (cols - 1) * gap, height = rows * (rowUnit || unit) + (rows - 1) * gap;
      const next = snapSize((width + dx + gap) / (unit + gap), (height + dy + gap) / ((rowUnit || unit) + gap));
      if (next !== sizes.get(kind)) { const before = boxes(); sizes.set(kind, next); tile.dataset.size = next; flip(before); }
      return;
    }
    // Where the tile's centre now is, from the pointer: independent of the grid reflowing under it.
    const center = { x: event.clientX - box.left - offset.x + tile.offsetWidth / 2, y: event.clientY - box.top - offset.y + tile.offsetHeight / 2 };
    const at = order.indexOf(kind), others = order.filter(value => value !== kind);
    const index = dropIndex({ others, size: sizes.get(kind), center, columns, metrics: { unit, rowUnit: rowUnit || unit, gap }, current: at });
    if (index !== at) { const before = boxes(); place([...others.slice(0, index), kind, ...others.slice(index)]); flip(before); }
    // Keep the lifted tile under the finger: set after any reflow, so a new slot cannot pull it away.
    follow(event);
  };
  const remember = () => { save(arranged(list(), order, sizes)); changed(); };
  const release = () => {
    clearTimeout(hold); hold = 0;
    if (tile) {
      tile.style.transform = ''; tile.classList.remove('dragging');
      if (moved) { suppress = true; remember(); }
    }
    tile = null; resizing = false; offset = null; grab = null;
  };
  const start = (node = null, event = null) => {
    if (mode) return;
    mode = true; read(); board.classList.add('arranging'); announce();
    if (node && event) pick(node, event);
  };
  const stop = () => {
    if (!mode) return;
    release(); mode = false; board.classList.remove('arranging');
    for (const node of nodes()) node.style.transform = '';
    announce();
  };
  const unpin = node => {
    const before = boxes(); node.remove();
    order = order.filter(value => value !== node.dataset.tile);
    remember(); flip(before);
  };

  const onDown = event => {
    suppress = false;
    const node = event.target.closest?.('.live-tile');
    if (!node) { if (mode) stop(); return; }
    if (!mode) {
      grab = { x: event.clientX, y: event.clientY };
      clearTimeout(hold);
      hold = setTimeout(() => { hold = 0; start(node, event); board.setPointerCapture?.(event.pointerId); }, HOLD);
      return;
    }
    // In arrange mode a press picks the tile up at once: the badge unpins, the corner resizes, the tile drags.
    const box = node.getBoundingClientRect(), at = { x: event.clientX - box.left, y: event.clientY - box.top };
    if (at.x < BADGE && at.y < BADGE) { event.preventDefault(); read(); unpin(node); return; }
    read(); pick(node, event);
  };
  const onMove = event => {
    if (hold) { if (Math.hypot(event.clientX - grab.x, event.clientY - grab.y) > 8) { clearTimeout(hold); hold = 0; } return; }
    if (!tile) return;
    event.preventDefault(); drag(event);
  };
  const onUp = () => { if (tile) release(); };
  const onClick = event => { if (suppress) { suppress = false; event.stopPropagation(); event.preventDefault(); } };
  const onKey = event => { if (event.key === 'Escape' && mode) stop(); };
  const onContext = event => { if (mode) event.preventDefault(); };

  board.addEventListener('pointerdown', onDown);
  board.addEventListener('pointermove', onMove);
  board.addEventListener('pointerup', onUp);
  board.addEventListener('pointercancel', onUp);
  board.addEventListener('click', onClick, true);
  board.addEventListener('contextmenu', onContext, true);
  addEventListener('keydown', onKey);
  return {
    arranging: () => mode,
    toggle: () => (mode ? stop() : start()),
    stop,
    dispose() {
      release();
      board.removeEventListener('pointerdown', onDown); board.removeEventListener('pointermove', onMove);
      board.removeEventListener('pointerup', onUp); board.removeEventListener('pointercancel', onUp);
      board.removeEventListener('click', onClick, true); board.removeEventListener('contextmenu', onContext, true);
      removeEventListener('keydown', onKey);
    }
  };
}
