// A scripted infiltrator for paired Shadow Protocol checks. This benchmark has
// privileged map-wide guard/camera positions and exact suspicion meters. It is
// repeatable, but does not model human vision, skill, or mission success rates.
import { TILE, toTile, kindAt, HIDING, zoneAt } from '../src/client/shadow-level.js';
import { findPath, smoothPath, playerWalk, lineClear, angleTo, wrapAngle, distanceField, index } from '../src/client/shadow-nav.js';

export const ROUTES = {
  culvert: [
    { to: [5, 34] }, { to: [5, 30], crouch: true }, { to: [7, 27] }, { to: [10, 23] }, { to: [17, 13] }, { to: [18, 12], crouch: true },
    { to: [21, 5], crouch: true }, { to: [24, 8] }, { to: [30, 8] }, { to: [31, 5], action: 'hack' },
    { to: [33, 8] }, { to: [42, 6] }, { to: [46, 6] }, { to: [53, 6], done: true },
  ],
  keycard: [
    { to: [29, 38] }, { to: [29, 33] }, { to: [30, 31] }, { to: [36, 30] }, { to: [46, 26] }, { to: [50, 25] }, { to: [50, 22] }, { to: [54, 16] },
    { to: [57, 16] }, { to: [58, 16], action: 'keycard' }, { to: [54, 15] }, { to: [52, 13] }, { to: [52, 11] }, { to: [42, 11] }, { to: [32, 11] },
    { to: [32, 8] }, { to: [31, 5], action: 'hack' },
    { to: [36, 7] }, { to: [42, 7] }, { to: [46, 7] }, { to: [53, 6], done: true },
  ],
  fence: [
    { to: [56, 34] }, { to: [58, 32], crouch: true }, { to: [58, 30], crouch: true }, { to: [52, 26] }, { to: [50, 23] }, { to: [53, 14] },
    { to: [52, 11] }, { to: [46, 3] }, { to: [40, 1.6] }, { to: [38, 3] }, { to: [36, 6] }, { to: [32, 8] }, { to: [31, 5], action: 'hack' },
    { to: [36, 7] }, { to: [42, 7] }, { to: [46, 7] }, { to: [53, 6], done: true },
  ],
};

const centerOf = ([tx, ty]) => ({ x: tx * TILE + 8, y: ty * TILE + 8 });

export class Bot {
  constructor(sim, { route = 'culvert', habit = 'locker', aggression = .3, distract = .3, seed = 1 } = {}) {
    if (!Object.hasOwn(ROUTES, route)) throw new Error(`Unknown bot route: ${route}`);
    this.sim = sim; this.plan = ROUTES[route]; this.routeName = route; this.habit = habit;
    this.aggression = aggression; this.distract = distract;
    this.stepIndex = 0; this.path = []; this.replanAt = 0; this.mode = 'route'; this.waitFor = 0; this.hideUntil = 0;
    this.hideSpot = null; this.r = seed >>> 0 || 1; this.lastPos = null; this.stuck = 0; this.held = false; this.crouch = false;
  }
  rand() { this.r = (this.r * 1664525 + 1013904223) >>> 0; return this.r / 4294967296; }

  walk(tx, ty, crouch = true) {
    if (!playerWalk(tx, ty, crouch)) return false;
    const door = this.sim.doors.get(index(tx, ty));
    return !door?.locked || this.sim.player.keycard || door.open > .62;
  }

  danger(tx, ty) {
    const sim = this.sim, x = tx * TILE + 8, y = ty * TILE + 8;
    let cost = 0;
    for (const g of sim.guards) {
      if (g.down) continue;
      const d = Math.hypot(g.x - x, g.y - y);
      if (d < 2.5 * TILE) cost += 14;
      if (d > sim.rules.range * TILE) continue;
      const off = Math.abs(wrapAngle(angleTo(g.x, g.y, x, y) - g.facing));
      if (off < sim.rules.fov / 2 + .25 && lineClear(g.x, g.y, x, y, sim.doorOpen, false)) cost += 40;
    }
    for (const c of sim.cameras) {
      if (!c.on) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d > c.range) continue;
      const off = Math.abs(wrapAngle(angleTo(c.x, c.y, x, y) - c.angle));
      if (off < .7 && lineClear(c.x, c.y, x, y, sim.doorOpen, false)) cost += 30;
    }
    return cost;
  }

  seen() { return this.sim.guards.some(g => g.sees) || this.sim.cameras.some(c => c.on && c.track > 0); }
  watched() { return this.sim.guards.some(g => !g.down && g.meter > .45); }

  input(dt) {
    const sim = this.sim, p = sim.player, out = { move: { x: 0, y: 0 } };
    if (sim.status !== 'playing') return out;
    const phase = sim.net.phase;
    if (this.seen() && this.mode !== 'flee' && this.mode !== 'hidden') { this.mode = 'flee'; this.rejected = null; this.pickHide(); this.path = []; }
    if (this.mode === 'hidden') {
      if (!p.locker && this.hideSpot?.type === 'locker') { this.mode = 'flee'; this.pickHide(); }
      const calm = phase === 'calm' || phase === 'caution' || phase === 'returning' || phase === 'lockdown';
      if ((calm && sim.t > this.hideUntil) || sim.t > this.hideUntil + 30) {
        if (p.locker) { this.mode = 'route'; this.path = []; return { ...out, interact: true }; }
        this.mode = 'route'; this.path = [];
      }
      if (this.crouch !== p.crouch && !p.locker) out.crouch = true;
      return out;
    }
    if (p.action?.kind === 'hack') return { ...out, interactHeld: true };
    if (this.mode === 'flee') return this.flee(out, dt);
    return this.follow(out, dt);
  }

  pickHide() {
    const sim = this.sim, p = sim.player, field = distanceField(toTile(p.x), toTile(p.y), (x, y) => this.walk(x, y));
    let best = null, bestScore = Infinity;
    const options = [];
    for (const spot of HIDING) {
      if (spot.type === 'locker') {
        const locker = sim.lockers.get(index(spot.x, spot.y));
        if (locker?.body || locker?.player) continue;
      }
      options.push({ ...spot, tile: [spot.x, spot.y] });
    }
    for (let ty = 0; ty < 44; ty++) for (let tx = 0; tx < 64; tx++) if (kindAt(tx, ty).hide === 'duct') options.push({ type: 'duct', x: tx, y: ty, tile: [tx, ty] });
    for (const spot of options) {
      if (this.rejected?.has(spot.x + ',' + spot.y)) continue;
      let d = Infinity;
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) d = Math.min(d, field[index(spot.x + dx, spot.y + dy)]);
      if (!Number.isFinite(d) || d > 22) continue;
      const sx = spot.x * TILE + 8, sy = spot.y * TILE + 8;
      const nearest = Math.min(...sim.guards.filter(g => !g.down).map(g => Math.hypot(g.x - sx, g.y - sy) / TILE));
      const visible = sim.guards.some(g => !g.down && (g.sees || g.state === 'alert') && Math.hypot(g.x - sx, g.y - sy) < 9 * TILE && lineClear(g.x, g.y, sx, sy, sim.doorOpen, true));
      const habit = spot.type === this.habit ? -6 : 0;
      const toward = sim.guards.some(g => !g.down && (g.sees || g.state === 'alert') && Math.hypot(g.x - sx, g.y - sy) < Math.hypot(p.x - sx, p.y - sy));
      const score = d + habit - Math.min(10, nearest) * .8 + (visible ? 12 : 0) + (spot.type === 'grass' && nearest < 4 ? 8 : 0) + (toward ? 10 : 0) - (spot.type === 'duct' ? 3 : 0);
      if (score < bestScore) { bestScore = score; best = spot; }
    }
    this.hideSpot = best;
  }

  flee(out) {
    const sim = this.sim, p = sim.player, spot = this.hideSpot;
    if (!spot) { this.pickHide(); if (!this.hideSpot) { this.mode = 'route'; return out; } }
    const target = this.hideSpot;
    let goal = [target.x, target.y];
    if (target.type === 'locker') {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.walk(target.x + dx, target.y + dy, false)) { goal = [target.x + dx, target.y + dy]; break; }
    }
    const here = [toTile(p.x), toTile(p.y)];
    if (here[0] === goal[0] && here[1] === goal[1] || Math.hypot(p.x - (goal[0] * TILE + 8), p.y - (goal[1] * TILE + 8)) < 7) {
      // Hiding in plain view is pointless: break line of sight first.
      if (this.seen() && target.type !== 'duct') {
        this.rejected = this.rejected || new Set();
        this.rejected.add(target.x + ',' + target.y);
        this.pickHide(); this.path = [];
        return out;
      }
      this.mode = 'hidden'; this.hideUntil = sim.t + 12 + this.rand() * 8;
      this.crouch = target.type !== 'locker';
      if (target.type === 'locker') return { ...out, interact: true };
      if (!p.crouch) out.crouch = true;
      return out;
    }
    const needCrouch = kindAt(goal[0], goal[1]).walk === 'crouch' || kindAt(here[0], here[1]).walk === 'crouch';
    if (needCrouch !== p.crouch && (needCrouch || kindAt(here[0], here[1]).walk !== 'crouch')) out.crouch = true;
    this.steer(out, goal, !needCrouch, true);
    return out;
  }

  /** Nearest tile within reach that no guard is looking at, out of sight of the watchers. */
  safeTile() {
    const sim = this.sim, p = sim.player, sx = toTile(p.x), sy = toTile(p.y);
    const watchers = sim.guards.filter(g => !g.down && (g.meter > .2 || g.sees || g.state === 'alert'));
    const seen = new Set([sx + ',' + sy]), queue = [[sx, sy, 0]];
    let best = null, bestScore = Infinity;
    while (queue.length) {
      const [tx, ty, d] = queue.shift();
      if (d > 9) continue;
      const x = tx * TILE + 8, y = ty * TILE + 8;
      const hidden = watchers.every(g => !lineClear(g.x, g.y, x, y, sim.doorOpen, true));
      const danger = this.danger(tx, ty);
      const score = d + danger * .4 + (hidden ? 0 : 20);
      if (d > 0 && score < bestScore) { bestScore = score; best = [tx, ty]; }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = tx + dx, ny = ty + dy, key = nx + ',' + ny;
        if (seen.has(key) || !this.walk(nx, ny)) continue;
        seen.add(key); queue.push([nx, ny, d + 1]);
      }
    }
    return best;
  }

  follow(out, dt) {
    const sim = this.sim, p = sim.player;
    const step = this.plan[this.stepIndex];
    if (!step) return out;
    if (this.watched() || this.retreat && sim.t < this.retreat.until) {
      if (!this.retreat || sim.t >= this.retreat.until) this.retreat = { tile: this.safeTile(), until: sim.t + 2.2 };
      const tile = this.retreat.tile;
      if (tile) {
        if (!p.crouch) out.crouch = true;
        if (Math.hypot(p.x - (tile[0] * TILE + 8), p.y - (tile[1] * TILE + 8)) > 5) this.steer(out, tile, false, true);
        else this.path = [];
        return out;
      }
    }
    const goal = step.to.map(Math.floor);
    const target = { x: step.to[0] * TILE + (Number.isInteger(step.to[0]) ? 8 : 0), y: step.to[1] * TILE + (Number.isInteger(step.to[1]) ? 8 : 0) };
    if (Math.hypot(p.x - target.x, p.y - target.y) < 10) {
      if (step.action === 'hack' && !p.data) return { ...out, interact: !p.action, interactHeld: true };
      if (step.action === 'keycard' && !p.keycard) return { ...out, interact: true };
      this.stepIndex++; this.path = [];
      return out;
    }
    // A guard with their back turned within reach: take them down if nobody else is looking.
    const reachable = sim.takedownTarget();
    if (reachable && this.aggression > 0 && !sim.guards.some(g => g !== reachable && !g.down && g.meter > .2)) return { ...out, interact: true };
    if (!this.path.length || sim.t >= this.replanAt) this.steer({ move: {} }, goal, false, false, target);
    const blocker = this.pathGuard(3.5 * TILE);
    const wantCrouch = Boolean(step.crouch) || this.watched() || Boolean(blocker) || this.dangerAhead();
    const tight = kindAt(toTile(p.x), toTile(p.y)).walk === 'crouch';
    if (wantCrouch !== p.crouch && !(p.crouch && tight)) out.crouch = true;
    if (blocker) {
      this.waitFor += dt;
      // A guard who stays put in the way: sneak up behind and take them down.
      const off = Math.abs(wrapAngle(angleTo(blocker.x, blocker.y, p.x, p.y) - blocker.facing));
      if (this.aggression > 0 && this.waitFor > 2.5 && !blocker.moving && off > sim.rules.fov / 2 + .5 && this.rand() < this.aggression + .4) {
        const behind = { x: blocker.x - Math.cos(blocker.facing) * 12, y: blocker.y - Math.sin(blocker.facing) * 12 };
        if (!p.crouch) out.crouch = true;
        this.steer(out, [toTile(behind.x), toTile(behind.y)], false, false, behind);
        return out;
      }
      if (this.waitFor > 4 && this.rand() < this.distract * dt * 1.5 && p.pebbles > 0) {
        // Throw a pebble past the guard, away from the route, to pull them off it.
        const a = angleTo(p.x, p.y, blocker.x, blocker.y) + (this.rand() < .5 ? 1.1 : -1.1);
        this.waitFor = 1;
        return { ...out, throw: true, aim: { x: blocker.x + Math.cos(a) * 4 * TILE, y: blocker.y + Math.sin(a) * 4 * TILE } };
      }
      if (this.waitFor < 30) return out;
    } else this.waitFor = 0;
    this.steer(out, goal, false, false, target);
    return out;
  }

  /** The first guard whose view or reach covers the next stretch of the planned path. */
  pathGuard(distance) {
    const sim = this.sim, p = sim.player;
    const points = [];
    let from = { x: p.x, y: p.y }, left = distance;
    for (const next of this.path) {
      const d = Math.hypot(next.x - from.x, next.y - from.y);
      for (let k = 6; k <= Math.min(d, left); k += 6) points.push({ x: from.x + (next.x - from.x) * k / d, y: from.y + (next.y - from.y) * k / d });
      left -= d; from = next;
      if (left <= 0) break;
    }
    for (const point of points) for (const g of sim.guards) {
      if (g.down) continue;
      const d = Math.hypot(g.x - point.x, g.y - point.y);
      if (d < 2.6 * TILE && lineClear(g.x, g.y, point.x, point.y, sim.doorOpen, false)) return g;
      if (d > sim.rules.range * TILE * 1.05) continue;
      const off = Math.abs(wrapAngle(angleTo(g.x, g.y, point.x, point.y) - g.facing));
      if (off < sim.rules.fov / 2 + .35 && lineClear(g.x, g.y, point.x, point.y, sim.doorOpen, p.crouch && kindAt(toTile(point.x), toTile(point.y)).walk !== 'crouch')) return g;
    }
    return null;
  }

  dangerAhead(strict = false) {
    const sim = this.sim, p = sim.player;
    const next = this.path[0];
    if (!next) return false;
    const x = p.x + Math.cos(angleTo(p.x, p.y, next.x, next.y)) * TILE * 1.4, y = p.y + Math.sin(angleTo(p.x, p.y, next.x, next.y)) * TILE * 1.4;
    for (const g of sim.guards) {
      if (g.down) continue;
      const d = Math.hypot(g.x - x, g.y - y);
      if (d > sim.rules.range * TILE * (strict ? .85 : 1)) continue;
      const off = Math.abs(wrapAngle(angleTo(g.x, g.y, x, y) - g.facing));
      if (off < sim.rules.fov / 2 + (strict ? .05 : .3) && lineClear(g.x, g.y, x, y, sim.doorOpen, p.crouch)) return true;
    }
    return false;
  }

  steer(out, goal, run, urgent, exact = null) {
    const sim = this.sim, p = sim.player;
    if (!this.path.length || sim.t >= this.replanAt) {
      this.replanAt = sim.t + (urgent ? .3 : .5);
      const tiles = findPath(toTile(p.x), toTile(p.y), goal[0], goal[1], (x, y) => this.walk(x, y), urgent ? (x, y) => this.danger(x, y) * .4 : (x, y) => this.danger(x, y));
      this.path = tiles ? smoothPath(tiles, (x, y) => this.walk(x, y), 5).slice(1) : [];
      if (exact && this.path.length) { const last = this.path[this.path.length - 1]; last.x = exact.x; last.y = exact.y; }
    }
    while (this.path.length && Math.hypot(this.path[0].x - p.x, this.path[0].y - p.y) < 5) this.path.shift();
    const next = this.path[0] || exact || centerOf(goal);
    const dx = next.x - p.x, dy = next.y - p.y, d = Math.hypot(dx, dy) || 1;
    out.move = { x: dx / d, y: dy / d };
    const tile = kindAt(toTile(next.x), toTile(next.y));
    if (tile.walk === 'crouch' && !p.crouch) out.crouch = true;
    out.run = run && !p.crouch;
    if (this.lastPos && Math.hypot(p.x - this.lastPos.x, p.y - this.lastPos.y) < .05) { this.stuck++; if (this.stuck > 40) { this.path = []; this.stuck = 0; out.move = { x: Math.cos(this.rand() * 6.28), y: Math.sin(this.rand() * 6.28) }; } }
    else this.stuck = 0;
    this.lastPos = { x: p.x, y: p.y };
  }
}

/** Runs one mission to the end (or the time limit) and returns the sim. */
export function playMission(sim, botOptions, limit = 600, dt = 1 / 30) {
  const bot = new Bot(sim, botOptions);
  let previousCrouchEdge = false;
  for (let t = 0; t < limit && sim.status === 'playing'; t += dt) {
    const input = bot.input(dt);
    if (input.crouch && previousCrouchEdge) input.crouch = false;
    previousCrouchEdge = Boolean(input.crouch);
    sim.step(dt, input);
  }
  return { sim, bot, zone: zoneAt(sim.player.x, sim.player.y) };
}
