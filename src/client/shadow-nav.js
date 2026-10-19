// Shadow Protocol's grid geometry: walkability, light, sight lines, A* paths
// and distance fields. Pure and DOM-free so the AI can run headless.
import { TILE, COLS, ROWS, LAMPS, AMBIENT, kindAt, toTile } from './shadow-level.js';

export const index = (tx, ty) => ty * COLS + tx;
export const inside = (tx, ty) => tx >= 0 && ty >= 0 && tx < COLS && ty < ROWS;
export const guardWalk = (tx, ty) => inside(tx, ty) && kindAt(tx, ty).walk === 'all';
export const playerWalk = (tx, ty, crouch) => {
  if (!inside(tx, ty)) return false;
  const walk = kindAt(tx, ty).walk;
  return walk === 'all' || (walk === 'crouch' && crouch);
};
// Sound travels anywhere a body could crawl, and through fences.
export const soundWalk = (tx, ty) => inside(tx, ty) && (kindAt(tx, ty).walk !== 'none' || kindAt(tx, ty).name === 'fence');

/** Visits every tile a segment crosses, in order. Stop by returning true. */
export function traverse(x0, y0, x1, y1, visit) {
  let tx = toTile(x0), ty = toTile(y0);
  const ex = toTile(x1), ey = toTile(y1);
  const dx = x1 - x0, dy = y1 - y0;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? TILE / Math.abs(dx) : Infinity, tDeltaY = dy !== 0 ? TILE / Math.abs(dy) : Infinity;
  let tMaxX = dx !== 0 ? (stepX > 0 ? (tx + 1) * TILE - x0 : x0 - tx * TILE) / Math.abs(dx) : Infinity;
  let tMaxY = dy !== 0 ? (stepY > 0 ? (ty + 1) * TILE - y0 : y0 - ty * TILE) / Math.abs(dy) : Infinity;
  for (let n = 0; n < 400; n++) {
    if (visit(tx, ty)) return true;
    if ((tx === ex && ty === ey) || Math.min(tMaxX, tMaxY) > 1) return false;
    if (Math.abs(tMaxX - tMaxY) < 1e-10) {
      // A ray crossing a corner touches both bordering tiles. Checking only
      // one side made visibility depend on which direction the ray was cast.
      if (visit(tx + stepX, ty) || visit(tx, ty + stepY)) return true;
      tMaxX += tDeltaX; tMaxY += tDeltaY; tx += stepX; ty += stepY;
    } else if (tMaxX < tMaxY) { tMaxX += tDeltaX; tx += stepX; } else { tMaxY += tDeltaY; ty += stepY; }
  }
  return false;
}

/**
 * True when nothing blocks sight between two points. Walls, trees, lockers,
 * ducts and closed doors always block; low cover blocks only a low target.
 * The two end tiles are not tested.
 */
export function lineClear(x0, y0, x1, y1, doorOpen = () => false, low = false) {
  const sx = toTile(x0), sy = toTile(y0), ex = toTile(x1), ey = toTile(y1);
  return !traverse(x0, y0, x1, y1, (tx, ty) => {
    if ((tx === sx && ty === sy) || (tx === ex && ty === ey)) return false;
    const sight = kindAt(tx, ty).sight;
    if (sight === 'block') return true;
    if (sight === 'door') return !doorOpen(tx, ty);
    return sight === 'low' && low;
  });
}

/** Static light: ambient plus lamps that can see the tile. Closed doors keep rooms separate. */
export const LIGHT = (() => {
  const light = new Float32Array(COLS * ROWS);
  for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
    const kind = kindAt(tx, ty);
    let value = kind.outdoor ? AMBIENT.outdoor : AMBIENT.indoor;
    const cx = tx + .5, cy = ty + .5;
    for (const lamp of LAMPS) {
      const d = Math.hypot(cx - lamp.x, cy - lamp.y);
      if (d >= lamp.r) continue;
      if (d > .8 && !lineClear(lamp.x * TILE, lamp.y * TILE, cx * TILE, cy * TILE)) continue;
      value += lamp.s * Math.pow(1 - d / lamp.r, 1.35);
    }
    light[index(tx, ty)] = Math.min(1, value);
  }
  return light;
})();
export const lightAt = (x, y) => {
  const tx = toTile(x), ty = toTile(y);
  return inside(tx, ty) ? LIGHT[index(tx, ty)] : 0;
};

class Heap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(node, priority) {
    const items = this.items;
    items.push([priority, node]);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent][0] <= items[i][0]) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items, top = items[0], last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let smallest = i;
        if (l < items.length && items[l][0] < items[smallest][0]) smallest = l;
        if (r < items.length && items[r][0] < items[smallest][0]) smallest = r;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top[1];
  }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

/** A* over tiles, eight directions without cutting corners. `cost` adds per-tile weight. */
export function findPath(sx, sy, gx, gy, passable = guardWalk, cost = null) {
  if (!inside(sx, sy) || !inside(gx, gy)) return null;
  if (!passable(gx, gy)) {
    const near = nearestPassable(gx, gy, passable);
    if (!near) return null;
    [gx, gy] = near;
  }
  if (!passable(sx, sy)) {
    const near = nearestPassable(sx, sy, passable);
    if (!near) return null;
    [sx, sy] = near;
  }
  const start = index(sx, sy), goal = index(gx, gy);
  const g = new Float32Array(COLS * ROWS).fill(Infinity), from = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const open = new Heap();
  g[start] = 0;
  open.push(start, 0);
  const h = (x, y) => { const dx = Math.abs(x - gx), dy = Math.abs(y - gy); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
  while (open.size) {
    const node = open.pop();
    if (closed[node]) continue;
    closed[node] = 1;
    if (node === goal) break;
    const x = node % COLS, y = (node / COLS) | 0;
    for (const [dx, dy, step] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!passable(nx, ny)) continue;
      if (dx && dy && (!passable(x + dx, y) || !passable(x, y + dy))) continue;
      const next = index(nx, ny);
      if (closed[next]) continue;
      const score = g[node] + step + (cost ? cost(nx, ny) : 0);
      if (score < g[next]) { g[next] = score; from[next] = node; open.push(next, score + h(nx, ny)); }
    }
  }
  if (from[goal] === -1 && goal !== start) return null;
  const path = [];
  for (let node = goal; node !== -1; node = from[node]) { path.push([node % COLS, (node / COLS) | 0]); if (node === start) break; }
  return path.reverse();
}

export function nearestPassable(tx, ty, passable = guardWalk, radius = 4) {
  for (let r = 0; r <= radius; r++) {
    let best = null, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = tx + dx, ny = ty + dy;
      if (!passable(nx, ny)) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = [nx, ny]; }
    }
    if (best) return best;
  }
  return null;
}

/** True when a body of radius r can walk the straight segment. */
export function walkableLine(x0, y0, x1, y1, passable = guardWalk, r = 5) {
  const dx = x1 - x0, dy = y1 - y0, length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length * r, ny = dx / length * r;
  for (const [ox, oy] of [[0, 0], [nx, ny], [-nx, -ny]]) {
    if (traverse(x0 + ox, y0 + oy, x1 + ox, y1 + oy, (tx, ty) => !passable(tx, ty))) return false;
  }
  return true;
}

/** Tile path → world waypoints, with corners pulled tight where the line is walkable. */
export function smoothPath(tiles, passable = guardWalk, r = 5) {
  if (!tiles || !tiles.length) return [];
  const points = tiles.map(([tx, ty]) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 }));
  const out = [points[0]];
  let anchor = 0;
  for (let i = 2; i < points.length; i++) {
    if (!walkableLine(points[anchor].x, points[anchor].y, points[i].x, points[i].y, passable, r)) {
      out.push(points[i - 1]);
      anchor = i - 1;
    }
  }
  if (points.length > 1) out.push(points[points.length - 1]);
  return out;
}

const fieldCache = new Map();
/** Dijkstra distances in tiles from one tile, over the given walkability. Cached. */
export function distanceField(tx, ty, passable = guardWalk, key = 'guard') {
  const id = key + ':' + tx + ',' + ty;
  const cached = fieldCache.get(id);
  if (cached) return cached;
  const dist = new Float32Array(COLS * ROWS).fill(Infinity);
  if (!inside(tx, ty)) return dist;
  const open = new Heap();
  dist[index(tx, ty)] = 0;
  open.push(index(tx, ty), 0);
  while (open.size) {
    const node = open.pop(), x = node % COLS, y = (node / COLS) | 0, here = dist[node];
    for (const [dx, dy, step] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!passable(nx, ny)) continue;
      if (dx && dy && (!passable(x + dx, y) || !passable(x, y + dy))) continue;
      const next = index(nx, ny), value = here + step;
      if (value < dist[next]) { dist[next] = value; open.push(next, value); }
    }
  }
  if (fieldCache.size > 160) fieldCache.delete(fieldCache.keys().next().value);
  fieldCache.set(id, dist);
  return dist;
}

/** Breadth-first sound spread from a point, in tiles, capped at `radius`. Walls stop it. */
export function soundField(x, y, radius, doorOpen = () => false) {
  const tx = toTile(x), ty = toTile(y), reach = new Map();
  if (!inside(tx, ty)) return reach;
  const open = new Heap();
  reach.set(index(tx, ty), 0);
  open.push(index(tx, ty), 0);
  while (open.size) {
    const node = open.pop(), cx = node % COLS, cy = (node / COLS) | 0, here = reach.get(node);
    if (here > radius) continue;
    for (const [dx, dy, step] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (!soundWalk(nx, ny)) continue;
      if (dx && dy && (!soundWalk(cx + dx, cy) || !soundWalk(cx, cy + dy))) continue;
      const kind = kindAt(nx, ny);
      const damp = kind.sight === 'door' && !doorOpen(nx, ny) ? 2.2 : 1;
      const value = here + step * damp, next = index(nx, ny);
      if (value <= radius && value < (reach.get(next) ?? Infinity)) { reach.set(next, value); open.push(next, value); }
    }
  }
  return reach;
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value = (value + 0x6d2b79f5) | 0;
    let next = Math.imul(value ^ (value >>> 15), 1 | value);
    next = (next + Math.imul(next ^ (next >>> 7), 61 | next)) ^ next;
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export const wrapAngle = angle => { while (angle > Math.PI) angle -= Math.PI * 2; while (angle < -Math.PI) angle += Math.PI * 2; return angle; };
export const turnToward = (current, target, rate) => { const diff = wrapAngle(target - current); return Math.abs(diff) <= rate ? target : current + Math.sign(diff) * rate; };
