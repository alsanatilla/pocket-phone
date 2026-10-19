// Today tile layout, shared by the browser board and its tests; TileLayout.java on the phone mirrors it exactly.
// Tiles are packed densely in order: each takes the first free spot, scanning row by row, where it fits, so small tiles fill
// gaps. That is the phone's packing and CSS grid's `dense` auto-flow, so the browser's grid draws what this computes.
export const SPANS = Object.freeze({ small: Object.freeze([1, 1]), square: Object.freeze([2, 2]), wide: Object.freeze([4, 2]) });
const span = size => SPANS[size] || SPANS.square;

/** [{ col, row, cols, rows }] for tile sizes in order, on a grid `columns` wide. */
export function pack(sizes, columns = 4) {
  const used = [], cells = [];
  const free = (row, col, cols, rows) => {
    if (col + cols > columns) return false;
    for (let r = row; r < row + rows; r++) for (let c = col; c < col + cols; c++) if (used[r]?.[c]) return false;
    return true;
  };
  for (const size of sizes) {
    const [cols, rows] = span(size), wide = Math.min(cols, columns);
    let at = 0;
    while (!free(Math.floor(at / columns), at % columns, wide, rows)) at++;
    const row = Math.floor(at / columns), col = at % columns;
    for (let r = row; r < row + rows; r++) { used[r] ||= Array(columns).fill(false); for (let c = col; c < col + wide; c++) used[r][c] = true; }
    cells.push({ col, row, cols: wide, rows });
  }
  return cells;
}

/** A cell's box in pixels from the board's content origin: `unit` and `rowUnit` are one column's width and one row's height. */
export const cellBox = (cell, { unit, rowUnit = unit, gap }) => ({
  left: cell.col * (unit + gap), top: cell.row * (rowUnit + gap),
  width: cell.cols * unit + (cell.cols - 1) * gap, height: cell.rows * rowUnit + (cell.rows - 1) * gap
});

/**
 * Where a dragged tile goes: the position in the order whose slot lies nearest the dragged tile's centre. `others` are the
 * other tiles' sizes in order. A move away from `current` must be clearly nearer, so a tile between two slots does not flicker.
 */
export function dropIndex({ others, size, center, columns = 4, metrics, current = -1 }) {
  const distance = index => {
    const sizes = [...others.slice(0, index), size, ...others.slice(index)], box = cellBox(pack(sizes, columns)[index], metrics);
    return Math.hypot(box.left + box.width / 2 - center.x, box.top + box.height / 2 - center.y);
  };
  let best = 0, nearest = Infinity;
  for (let index = 0; index <= others.length; index++) { const d = distance(index); if (d < nearest) { nearest = d; best = index; } }
  if (current >= 0 && current <= others.length && best !== current && distance(current) - nearest < 0.3 * Math.min(metrics.unit, metrics.rowUnit ?? metrics.unit)) return current;
  return best;
}

/** The size whose footprint is nearest the area a resize handle has been dragged to, measured in grid cells from the tile's corner. */
export function snapSize(cols, rows, sizes = Object.keys(SPANS)) {
  let best = sizes[0], nearest = Infinity;
  for (const size of sizes) { const [c, r] = span(size), d = (c - cols) ** 2 + (r - rows) ** 2; if (d < nearest) { nearest = d; best = size; } }
  return best;
}

/** `list` with the item at `from` moved to `to`. */
export function moved(list, from, to) {
  const next = [...list], [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

/** The saved list from an arranged order and sizes: each tile keeps its stored data, and only known kinds survive. */
export function arranged(list, order, sizes = new Map()) {
  const by = new Map(list.map(item => [item.kind, item]));
  return order.filter(kind => by.has(kind)).map(kind => ({ ...by.get(kind), kind, ...(sizes.get(kind) ? { size: sizes.get(kind) } : {}) }));
}
