// Shadow Protocol's simulation. Pure and DOM-free: the browser and the node
// evaluation harness run the same rules. Guards move, see, hear and react
// deterministically; the commander (Jev or its local System-One stand-in)
// chooses the tactics at decision points and never sees the player directly.
import {
  TILE, COLS, ROWS, START, ZONE_BY_ID, CAMERAS, PATROLS, GUARD_SLOTS, POSTS, POST_BY_ID, HIDING,
  HIDING_CLUSTERS, PANEL, TERMINAL, KEYCARD, EXTRACTION, ENTRIES, LAB_ENTRIES, ZONES, PORTALS,
  kindAt, tileAt, toTile, zoneAt, zoneOfTile,
} from './shadow-level.js';
import {
  guardWalk, playerWalk, lineClear, lightAt, findPath, smoothPath, walkableLine, distanceField, soundField,
  mulberry32, angleTo, wrapAngle, turnToward, nearestPassable, index, inside,
} from './shadow-nav.js';
import { readAnswers, planFromAnswers } from '../shared/shadow-jev.js';
import { buildSituation, localAnswers, emptyDossier } from './shadow-commander.js';

export const DIFFICULTY = Object.freeze({
  normal: Object.freeze({
    id: 'normal', name: 'Normal', guards: 9, detect: .9, range: 7, fov: 1.5, peripheral: 2.2, report: 1.5, radio: 1.1,
    replan: 7, gap: 2.4, search: 36, lockdown: 28, influence: .5, coordination: 3, chase: 94, capture: 15,
    captureTime: .9, pebbles: 6, checkin: 55, breach: 28, panelNotice: 35, turn: 3.6, reaction: .75,
    scannerInAlert: true, probe: .3, hearing: 1,
  }),
  hard: Object.freeze({
    id: 'hard', name: 'Hard', guards: 10, detect: 1.22, range: 7.8, fov: 1.6, peripheral: 2.6, report: 1.15, radio: .8,
    replan: 5, gap: 1.8, search: 48, lockdown: 38, influence: .8, coordination: 4, chase: 104, capture: 16,
    captureTime: .62, pebbles: 5, checkin: 42, breach: 18, panelNotice: 22, turn: 4.2, reaction: .58,
    scannerInAlert: false, probe: .5, hearing: 1.15,
  }),
  extreme: Object.freeze({
    id: 'extreme', name: 'Extreme', guards: 11, detect: 1.45, range: 8.4, fov: 1.7, peripheral: 3, report: .85, radio: .55,
    replan: 3.6, gap: 1.3, search: 62, lockdown: 48, influence: 1, coordination: 6, chase: 111, capture: 17,
    captureTime: .52, pebbles: 4, checkin: 30, breach: 10, panelNotice: 12, turn: 4.8, reaction: .45,
    scannerInAlert: false, probe: .72, hearing: 1.3,
  }),
});

export const SPEED = Object.freeze({ crouch: 40, walk: 76, run: 134 });
// Velocity eases toward the stick: quick to start, a little quicker to stop.
const ACCEL_TIME = .035, DECEL_TIME = .028;
const PLAYER_R = 5, GUARD_R = 5.5;
const LEVEL_DETECT = [.9, 1, 1.12, 1.25];
const STATE_SPEED = { patrol: 36, returning: 40, investigate: 44, suspicious: 0, search: 56, lockdown: 72 };
const SECTOR_PATROL = { warehouse: ['warehouse', 1], yard: ['yard', 1], corridors: ['corridorB', 0], barracks: ['barracks', 1], lab: ['lab', 1], north: ['helipad', 0], exterior: ['perimeter', 0], perimeter: ['backlot', 0] };
const OBJECTIVE_ROLES = new Set(['guard']);

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const world = ([tx, ty]) => ({ x: tx * TILE, y: ty * TILE });
const rounded = value => Math.round(value * 10) / 10;
const planSignature = ({ confidence, ...behavior }) => JSON.stringify(behavior);

export function zoneSearchPoints(zoneId) {
  const zone = ZONE_BY_ID[zoneId];
  if (!zone) return [];
  const tiles = [];
  for (const rect of zone.rects || [zone.rect]) for (let ty = rect[1]; ty <= rect[3]; ty++) for (let tx = rect[0]; tx <= rect[2]; tx++) {
    if (guardWalk(tx, ty) && zoneOfTile(tx, ty) === zoneId) tiles.push([tx, ty]);
  }
  const points = [];
  for (const tile of tiles) if (!points.some(point => Math.hypot(point[0] - tile[0], point[1] - tile[1]) < 3.6)) points.push(tile);
  return points.map(([tx, ty]) => ({ x: tx * TILE + 8, y: ty * TILE + 8 }));
}
const SEARCH_POINTS = Object.fromEntries(ZONES.map(zone => [zone.id, zoneSearchPoints(zone.id)]));

/** The walkable tile a guard stands on to look into a locker or grass spot. */
function spotApproach(spot) {
  if (spot.type === 'grass') return { x: spot.x * TILE + 8, y: spot.y * TILE + 8 };
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (guardWalk(spot.x + dx, spot.y + dy)) return { x: (spot.x + dx) * TILE + 8, y: (spot.y + dy) * TILE + 8 };
  return { x: spot.x * TILE + 8, y: spot.y * TILE + 8 };
}

export class ShadowSim {
  constructor({ difficulty = 'normal', seed = Date.now(), mode = 'commander', dossier = null, remote = null, log = null } = {}) {
    this.rules = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    this.seed = seed >>> 0;
    this.random = mulberry32(this.seed);
    this.mode = mode === 'baseline' ? 'baseline' : 'commander';
    this.dossier = dossier || emptyDossier();
    this.remote = typeof remote === 'function' ? remote : null;
    this.onLog = log;
    this.t = 0;
    this.status = 'playing';
    this.player = {
      x: START.x, y: START.y, facing: -Math.PI / 2, crouch: false, running: false, moving: false, speed: 0, vx: 0, vy: 0, aiming: false,
      hidden: null, locker: null, carrying: null, keycard: false, data: false, pebbles: this.rules.pebbles,
      step: 0, action: null, anim: 0, visibility: 0, noise: 0, caught: 0, cameraOff: false,
      ammo: 3, maxAmmo: 6, shotAt: -99, recoil: 0,
    };
    this.doors = new Map();
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) {
      const ch = tileAt(tx, ty);
      if (ch === 'D' || ch === 'K') this.doors.set(index(tx, ty), { tx, ty, open: 0, locked: ch === 'K' });
    }
    this.cameras = CAMERAS.map((camera, i) => ({
      ...camera, x: camera.x * TILE, y: camera.y * TILE, angle: camera.facing, phase: this.random() * Math.PI * 2,
      meter: 0, on: true, track: 0, range: camera.range * TILE, index: i,
    }));
    this.keycardOnDesk = true;
    this.lockers = new Map(HIDING.filter(spot => spot.type === 'locker').map(spot => [index(spot.x, spot.y), { ...spot, body: null, player: false }]));
    this.pebbles = [];
    this.rings = [];
    this.blood = [];
    this.tracers = [];
    this.slashes = [];
    this.events = [];
    this.radio = [];
    this.queue = [];
    this.decisions = [];
    this.decisionSerial = 0;
    this.mission = { entry: null, labEntry: null, breachAt: null, breachKnown: false, panelAt: null, traces: new Set(), seenKeycardGone: false, progress: { hack: 0, panel: 0 } };
    this.net = {
      phase: 'calm', phaseSince: 0, level: 1, lastSeen: null, sightings: [], evidence: [], plan: null, decision: null,
      lastDecisionAt: -99, nextSweep: 0, searchUntil: 0, lockdownUntil: 0, calmAt: 0, missing: new Set(), found: new Set(),
      camerasOff: false, breach: false, keycardMissing: false, searched: {}, checked: {}, nextCheckin: this.rules.checkin,
      prediction: null, lostAt: null, lostEpisode: null, pendingAnomaly: null, alertEpisode: null, posture: null,
    };
    this.metrics = {
      alerts: 0, sightings: 0, cameraSightings: 0, interceptions: 0, searches: 0, reacquired: 0, reacquireTimes: [],
      recoveries: 0, takedowns: 0, kills: 0, shots: 0, killPoints: 0, killChain: 0, bestChain: 0, lastKillAt: -99,
      cameraShots: 0, corpsesFound: 0, bodiesFound: 0, missingNoticed: 0, noises: 0, distractions: 0, predictionsHit: 0,
      predictionsMiss: 0, alertTime: 0, decisions: 0, jevDecisions: 0, jevFailures: 0, foundHiding: 0, lockerChecks: 0,
      escapes: [], vanish: [], foundIn: [], afterDetect: [], runningTime: 0, movingTime: 0,
    };
    this.guards = this.setupGuards();
    if (this.mode === 'commander') this.decide('posture', null);
    else this.applyBaselinePosture();
  }

  /* ── setup ─────────────────────────────────────────────────────────────── */

  setupGuards() {
    const random = this.random;
    const core = GUARD_SLOTS.filter(slot => slot.core);
    const reserve = GUARD_SLOTS.filter(slot => !slot.core);
    for (let i = reserve.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [reserve[i], reserve[j]] = [reserve[j], reserve[i]]; }
    const slots = [...core, ...reserve.slice(0, Math.max(0, this.rules.guards - core.length))];
    return slots.map((slot, i) => {
      const variants = PATROLS[slot.patrol];
      const variant = Math.floor(random() * variants.length);
      const guard = {
        id: slot.id, name: slot.name, slot: slot.id, n: i + 1, home: slot.patrol, patrolKey: slot.patrol, variant,
        route: this.routeFor(slot.patrol, variant), routeIndex: 0, hold: 0, objective: Boolean(slot.objective),
        reserve: !slot.core, keycard: slot.id === 'g7',
        x: 0, y: 0, facing: 0, look: 0, state: 'patrol', meter: 0, sees: false, lastSeen: null, lostFor: 0,
        reportIn: 0, reported: false, nextUpdate: 0, reaction: 0, cue: null, task: null, pendingTask: null,
        path: [], pathGoal: null, pathAge: 0, scan: null, down: false, dead: false, deadAt: 0, deathAngle: 0, grabbed: false, carried: false, hidden: false,
        groggy: 0, bodyMeter: 0, bodyTarget: null, indicator: '', indicatorAt: -9, knowledge: null, ackDue: null,
        known: null, lastAction: 'patrolling', moving: false, anim: random() * 10, speedMul: 1, stuck: 0,
        lockerCheck: null, lastLockerCheck: 0, waitOrders: 0,
      };
      const first = guard.route[0];
      guard.x = first.x; guard.y = first.y;
      guard.facing = first.face ?? 0;
      guard.known = { x: guard.x, y: guard.y, zone: zoneAt(guard.x, guard.y), state: guard.state, t: 0 };
      return guard;
    });
  }

  routeFor(key, variant = 0, options = {}) {
    const list = PATROLS[key] || PATROLS.yard;
    let points = (list[variant % list.length] || list[0]).map(([x, y, kind, face, hold]) => ({ x: x * TILE, y: y * TILE, hold: kind === 'hold' ? hold : 0, face }));
    if (options.reverse) points = points.slice().reverse();
    if (options.stagger) points = points.map(point => ({ ...point, hold: point.hold ? point.hold * options.stagger() : (options.stagger() > 1.5 ? 1.5 : 0) }));
    return points;
  }

  applyBaselinePosture() {
    this.net.posture = { strategy: 'posture', summary: 'Standard patrols', focus: null, watch: null, pattern: 'standard', probe: false };
    this.net.level = 1;
  }

  /* ── helpers ───────────────────────────────────────────────────────────── */

  doorOpen = (tx, ty) => {
    const door = this.doors.get(index(tx, ty));
    return !door || door.open > .55;
  };
  playerPassable = (tx, ty) => {
    if (!playerWalk(tx, ty, this.player.crouch)) return false;
    const door = this.doors.get(index(tx, ty));
    return !door || door.open > .62;
  };
  guardPassable = (tx, ty) => guardWalk(tx, ty);
  guardBlocked = (tx, ty) => {
    if (!guardWalk(tx, ty)) return true;
    const door = this.doors.get(index(tx, ty));
    return Boolean(door && door.open < .5);
  };

  say(from, text, tone = '') {
    const line = { t: this.t, from, text, tone };
    this.radio.unshift(line);
    this.radio.length = Math.min(this.radio.length, 14);
    this.onLog?.(line);
  }
  emit(type, data = {}) { this.events.push({ type, t: this.t, ...data }); if (this.events.length > 60) this.events.shift(); }

  blocked(x, y, r, passable) {
    const x0 = toTile(x - r), x1 = toTile(x + r), y0 = toTile(y - r), y1 = toTile(y + r);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      if (passable(tx, ty)) continue;
      const cx = Math.max(tx * TILE, Math.min(x, tx * TILE + TILE)), cy = Math.max(ty * TILE, Math.min(y, ty * TILE + TILE));
      if ((cx - x) ** 2 + (cy - y) ** 2 < r * r - .01) return true;
    }
    return false;
  }
  /** Moves axis by axis. With `nudge`, a body pushed straight into a corner slides sideways around it. */
  moveBody(body, dx, dy, r, passable, nudge = 0) {
    let x = false, y = false;
    if (dx) {
      if (!this.blocked(body.x + dx, body.y, r, passable)) { body.x += dx; x = true; }
      else if (nudge && Math.abs(dy) < Math.abs(dx) * .35) y = this.slideAround(body, dx, 0, r, passable, nudge);
    }
    if (dy) {
      if (!this.blocked(body.x, body.y + dy, r, passable)) { body.y += dy; y = true; }
      else if (nudge && Math.abs(dx) < Math.abs(dy) * .35) x = this.slideAround(body, 0, dy, r, passable, nudge) || x;
    }
    return { x, y };
  }

  /** Finds the nearest sideways offset (up to `nudge` px) that frees the forward move, and steps toward it. */
  slideAround(body, dx, dy, r, passable, nudge) {
    const step = Math.max(Math.abs(dx), Math.abs(dy));
    for (let k = 1; k <= nudge; k++) for (const side of [-1, 1]) {
      const ox = dy ? side * k : 0, oy = dx ? side * k : 0;
      if (this.blocked(body.x + ox, body.y + oy, r, passable)) continue;
      if (this.blocked(body.x + ox + dx, body.y + oy + dy, r, passable)) continue;
      const shift = Math.min(k, step);
      body.x += Math.sign(ox) * shift; body.y += Math.sign(oy) * shift;
      return true;
    }
    return false;
  }

  /* ── main step ─────────────────────────────────────────────────────────── */

  step(dt, input = {}) {
    if (this.status !== 'playing') return;
    this.t += dt;
    this.updatePlayer(dt, input);
    this.updateDoors(dt);
    this.updatePebbles(dt);
    this.updateEffects(dt);
    this.updateCameras(dt);
    for (const guard of this.guards) this.perceive(guard, dt);
    for (const guard of this.guards) this.think(guard, dt);
    this.separate();
    this.updateNet(dt);
    this.updateCapture(dt);
    this.updateMission();
    for (const ring of this.rings) ring.age += dt;
    this.rings = this.rings.filter(ring => ring.age < ring.life);
  }

  /* ── player ────────────────────────────────────────────────────────────── */

  updatePlayer(dt, input) {
    const p = this.player;
    p.anim += dt;
    if (input.crouch) {
      // Standing up needs headroom for the whole body, not just its centre.
      if (!p.crouch) p.crouch = true;
      else if (!this.blocked(p.x, p.y, PLAYER_R, (tx, ty) => playerWalk(tx, ty, false) && this.doorOpen(tx, ty))) p.crouch = false;
      else this.emit('hint', { text: 'no room to stand' });
    }
    if (p.locker) {
      if (input.interact || Math.hypot(input.move?.x || 0, input.move?.y || 0) > .5) this.leaveLocker();
      p.moving = false; p.speed = 0; p.vx = 0; p.vy = 0; p.visibility = 0; p.aiming = false;
      return;
    }
    if (p.action) { p.aiming = false; this.updateAction(dt, input); return; }
    if (input.interact) this.interact();
    if (input.knife) this.knife();
    if (input.shoot) this.shoot(input.aim);
    if (input.knock) this.knock();
    if (input.throw) this.throwPebble(input.aim);
    if (p.action) return;

    let mx = input.move?.x || 0, my = input.move?.y || 0;
    const length = Math.hypot(mx, my);
    if (length > 1) { mx /= length; my /= length; }
    const wants = length > .2;
    p.aiming = Boolean(input.aimHold) && !p.carrying;
    const running = Boolean(input.run) && !p.crouch && !p.carrying && !p.aiming && wants;
    const top = p.carrying ? SPEED.crouch * .9 : p.crouch ? SPEED.crouch : running ? SPEED.run : SPEED.walk;
    const k = 1 - Math.exp(-dt / (wants ? ACCEL_TIME : DECEL_TIME));
    p.vx += ((wants ? mx * top : 0) - p.vx) * k;
    p.vy += ((wants ? my * top : 0) - p.vy) * k;
    if (!wants && Math.hypot(p.vx, p.vy) < 3) { p.vx = 0; p.vy = 0; }
    p.running = running;
    p.speed = Math.hypot(p.vx, p.vy);
    p.moving = p.speed > 6;
    const aim = input.aim && Number.isFinite(input.aim.x) && Number.isFinite(input.aim.y) ? input.aim : null;
    if (p.aiming && aim) p.facing = angleTo(p.x, p.y, aim.x, aim.y);
    else if (wants) p.facing = Math.atan2(my, mx);
    if (p.speed > 0) {
      const before = { x: p.x, y: p.y };
      const moved = this.moveBody(p, p.vx * dt, p.vy * dt, PLAYER_R, this.playerPassable, 6);
      // A wall stops momentum on that axis; a corner nudge counts as movement.
      if (!moved.x) p.vx = 0;
      if (!moved.y) p.vy = 0;
      p.step += Math.hypot(p.x - before.x, p.y - before.y);
      if (p.moving) {
        this.metrics.movingTime += dt;
        if (running) this.metrics.runningTime += dt;
      }
      if (p.step >= 18) { p.step = 0; this.footstep(); }
      this.noteTraces();
    }
    if (p.carrying) {
      const body = this.guards.find(g => g.id === p.carrying);
      if (body) { body.x = p.x - Math.cos(p.facing) * 9; body.y = p.y - Math.sin(p.facing) * 9; }
    }
    const kind = kindAt(toTile(p.x), toTile(p.y));
    p.hidden = kind.hide === 'duct' ? 'duct' : kind.hide === 'grass' && p.crouch ? 'grass' : null;
    const light = lightAt(p.x, p.y);
    const posture = p.hidden === 'duct' ? 0 : p.hidden === 'grass' ? .22 : p.crouch ? .6 : 1;
    const motion = !p.moving ? .72 : running ? 1.32 : p.crouch ? .85 : 1;
    p.visibility = Math.min(1, (.16 + .84 * light) * posture * motion * (p.carrying ? 1.3 : 1));
  }

  noteTraces() {
    const p = this.player, tx = toTile(p.x), ty = toTile(p.y);
    if (!this.mission.entry) for (const entry of ENTRIES) if (entry.test(tx, ty)) this.mission.entry = entry.id;
    if (!this.mission.labEntry) for (const entry of LAB_ENTRIES) if (entry.test(tx, ty)) this.mission.labEntry = entry.id;
  }

  footstep() {
    const p = this.player;
    const kind = kindAt(toTile(p.x), toTile(p.y));
    const surface = kind.sound ?? 1;
    const base = p.crouch ? .55 : p.running ? 5.2 : 1.7;
    const radius = base * surface;
    p.noise = radius;
    if (radius < 1.05) return;
    this.noise(p.x, p.y, radius, p.running ? 'running footsteps' : 'footsteps', 'step');
  }

  knock() {
    const p = this.player;
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => kindAt(toTile(p.x + dx * 9), toTile(p.y + dy * 9)).sight === 'block');
    if (!near) { this.emit('hint', { text: 'stand against a wall to knock' }); return; }
    this.noise(p.x, p.y, 3.4, 'a knock', 'knock');
    this.metrics.distractions++;
  }

  throwPebble(aim) {
    const p = this.player;
    if (p.pebbles <= 0 || p.carrying) { this.emit('hint', { text: p.pebbles <= 0 ? 'no pebbles left' : 'hands full' }); return; }
    let angle = p.facing, reach = 5 * TILE;
    if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y)) {
      angle = angleTo(p.x, p.y, aim.x, aim.y);
      reach = Math.min(6.5 * TILE, Math.max(2 * TILE, Math.hypot(aim.x - p.x, aim.y - p.y)));
    }
    let tx = p.x + Math.cos(angle) * reach, ty = p.y + Math.sin(angle) * reach;
    let last = { x: p.x, y: p.y };
    const steps = Math.ceil(reach / 4);
    for (let i = 1; i <= steps; i++) {
      const x = p.x + Math.cos(angle) * reach * i / steps, y = p.y + Math.sin(angle) * reach * i / steps;
      const kind = kindAt(toTile(x), toTile(y));
      if (kind.sight === 'block' || (kind.sight === 'door' && !this.doorOpen(toTile(x), toTile(y)))) break;
      last = { x, y };
    }
    tx = last.x; ty = last.y;
    p.pebbles--;
    const length = Math.hypot(tx - p.x, ty - p.y);
    this.pebbles.push({ x0: p.x, y0: p.y, x1: tx, y1: ty, x: p.x, y: p.y, t: 0, dur: Math.max(.15, length / 240) });
    this.metrics.distractions++;
  }

  updatePebbles(dt) {
    for (const pebble of this.pebbles) {
      pebble.t += dt;
      const k = Math.min(1, pebble.t / pebble.dur);
      pebble.x = pebble.x0 + (pebble.x1 - pebble.x0) * k;
      pebble.y = pebble.y0 + (pebble.y1 - pebble.y0) * k;
      pebble.z = Math.sin(k * Math.PI) * 10;
      if (k >= 1 && !pebble.done) {
        pebble.done = true;
        const surface = kindAt(toTile(pebble.x), toTile(pebble.y)).sound ?? 1;
        this.noise(pebble.x, pebble.y, 4.6 * Math.max(.85, surface), 'a clatter', 'pebble');
      }
    }
    this.pebbles = this.pebbles.filter(pebble => !pebble.done || pebble.t < pebble.dur + .4);
  }

  updateEffects(dt) {
    this.player.recoil = Math.max(0, this.player.recoil - dt);
    for (const stain of this.blood) stain.age += dt;
    for (const tracer of this.tracers) tracer.age += dt;
    this.tracers = this.tracers.filter(tracer => tracer.age < tracer.life);
    for (const slash of this.slashes) slash.age += dt;
    this.slashes = this.slashes.filter(slash => slash.age < slash.life);
  }

  /** A guard the knife can reach: unaware from behind, or already on the floor. */
  knifeTarget() {
    const p = this.player;
    let best = null, bestD = 23;
    for (const g of this.guards) {
      if (g.dead || g.grabbed || g.hidden || g.carried) continue;
      const d = dist(g, p);
      if (d >= bestD) continue;
      if (!g.down) {
        const off = Math.abs(wrapAngle(angleTo(g.x, g.y, p.x, p.y) - g.facing));
        const aware = g.sees || g.meter > .8;
        if (aware || off < this.rules.fov / 2 + .3) continue;
        if (!walkableLine(p.x, p.y, g.x, g.y, this.playerPassable, PLAYER_R)) continue;
      }
      best = g; bestD = d;
    }
    return best;
  }

  /** The knife is silent; the pistol is not. Both end a guard permanently. */
  knife() {
    const p = this.player;
    if (p.carrying) { this.emit('hint', { text: 'hands full' }); return; }
    if (p.action) return;
    const target = this.knifeTarget();
    if (!target) { this.emit('hint', { text: 'no one within knife reach' }); return; }
    p.action = { kind: 'kill', t: 0, need: .42, target: target.id };
    if (!target.down) target.grabbed = true;
    this.emit('knife', { guard: target.id });
  }

  shoot(aim) {
    const p = this.player;
    if (p.carrying) { this.emit('hint', { text: 'hands full' }); return; }
    if (p.action) return;
    if (p.ammo <= 0) { this.emit('hint', { text: 'pistol empty — use the knife' }); return; }
    let angle = p.facing;
    if (aim && Number.isFinite(aim.x) && Number.isFinite(aim.y)) angle = angleTo(p.x, p.y, aim.x, aim.y);
    else {
      const assist = this.aimAssist(angle);
      if (assist) angle = angleTo(p.x, p.y, assist.x, assist.y);
    }
    p.facing = angle; p.ammo--; p.shotAt = this.t; p.recoil = .18;
    this.metrics.shots++;
    const range = 9.5 * TILE;
    let end = { x: p.x + Math.cos(angle) * range, y: p.y + Math.sin(angle) * range };
    let struck = null;
    const steps = Math.ceil(range / 3);
    for (let i = 1; i <= steps; i++) {
      const x = p.x + Math.cos(angle) * range * i / steps;
      const y = p.y + Math.sin(angle) * range * i / steps;
      const tx = toTile(x), ty = toTile(y);
      end = { x, y };
      const guard = this.guards.find(g => !g.dead && !g.hidden && Math.hypot(g.x - x, g.y - y) < 7);
      if (guard) { struck = { kind: 'guard', guard }; break; }
      // A camera sits on a wall, so it is checked before the wall stops the round.
      const camera = this.cameras.find(item => item.on && Math.hypot(item.x - x, item.y - y) < 8);
      if (camera) { struck = { kind: 'camera', camera }; break; }
      const kind = kindAt(tx, ty);
      if (kind.sight === 'block' || (kind.sight === 'door' && !this.doorOpen(tx, ty))) break;
    }
    this.tracers.push({ x0: p.x + Math.cos(angle) * 6, y0: p.y + Math.sin(angle) * 6, x1: end.x, y1: end.y, age: 0, life: .16, hit: struck?.kind || 'wall' });
    this.noise(p.x, p.y, 14, 'a gunshot', 'gunshot');
    this.emit('shot', { x: p.x, y: p.y, angle, hit: struck?.kind || 'wall' });
    if (struck?.kind === 'guard') this.killGuard(struck.guard, 'gun');
    else if (struck?.kind === 'camera') {
      const camera = struck.camera;
      camera.on = false; camera.track = 0; camera.meter = 0;
      this.metrics.cameraShots++;
      this.emit('toast', { text: 'camera destroyed' });
      if (this.cameras.every(item => !item.on)) {
        this.net.camerasOff = true;
        this.mission.panelAt = this.mission.panelAt ?? this.t;
      }
    }
  }

  /** The nearest standing guard within 0.6 rad of `angle`, in pistol range and in sight. */
  aimAssist(angle) {
    const p = this.player, range = 9.5 * TILE;
    let best = null, bestScore = Infinity;
    for (const g of this.guards) {
      if (g.down || g.dead || g.hidden) continue;
      const d = dist(g, p), off = Math.abs(wrapAngle(angleTo(p.x, p.y, g.x, g.y) - angle));
      if (d > range || off > .6 || !lineClear(p.x, p.y, g.x, g.y, this.doorOpen, false)) continue;
      const score = d + off * 120;
      if (score < bestScore) { bestScore = score; best = g; }
    }
    return best;
  }

  killGuard(g, how = 'knife') {
    if (g.dead) return;
    const p = this.player;
    g.dead = true; g.down = true; g.grabbed = false; g.sees = false; g.meter = 0; g.state = 'dead';
    g.task = null; g.pendingTask = null; g.path = []; g.bodyClaimed = null; g.deadAt = this.t; g.deathAngle = p.facing;
    for (const other of this.guards) {
      if (other.bodyTarget === g.id) other.bodyTarget = null;
      if (other.bodyClaimed === g.id) other.bodyClaimed = null;
    }
    g.indicator = ''; g.lastAction = how === 'gun' ? 'shot' : 'knifed';
    if (g.keycard && !p.keycard) { p.keycard = true; g.keycard = false; this.emit('toast', { text: `${g.name}’s keycard` }); }
    if (how === 'knife') {
      p.ammo = Math.min(p.maxAmmo, p.ammo + 1);
      this.slashes.push({ x: g.x, y: g.y, angle: p.facing, age: 0, life: .24 });
      this.noise(g.x, g.y, 1.8, 'a muffled struggle', 'scuffle');
    }
    this.metrics.kills++;
    const chain = this.t - this.metrics.lastKillAt <= 6 ? this.metrics.killChain + 1 : 1;
    this.metrics.lastKillAt = this.t; this.metrics.killChain = chain;
    this.metrics.bestChain = Math.max(this.metrics.bestChain, chain);
    const points = 120 * chain;
    this.metrics.killPoints += points;
    this.spawnBlood(g.x, g.y, p.facing, how);
    this.emit('kill', { guard: g.id, how, chain, points });
  }

  spawnBlood(x, y, angle, how) {
    const count = how === 'gun' ? 14 : 9;
    for (let i = 0; i < count; i++) {
      const spread = angle + (this.random() * 2 - 1) * (how === 'gun' ? 1.5 : 2.2);
      const reach = this.random() * (how === 'gun' ? 21 : 12);
      this.blood.push({ x: x + Math.cos(spread) * reach, y: y + Math.sin(spread) * reach, r: .7 + this.random() * 1.7, age: 0, pool: false });
    }
    this.blood.push({ x, y, r: how === 'gun' ? 5.2 : 4.2, age: 0, pool: true });
    if (this.blood.length > 150) this.blood.splice(0, this.blood.length - 150);
  }

  interact() {
    const p = this.player;
    if (p.carrying) { this.dropBody(); return; }
    const target = this.takedownTarget();
    if (target) {
      p.action = { kind: 'takedown', t: 0, need: .55, target: target.id };
      target.grabbed = true;
      return;
    }
    const body = this.guards.find(g => g.down && !g.hidden && !g.carried && dist(g, p) < 18);
    if (body) {
      p.carrying = body.id; body.carried = true;
      if (body.keycard && !p.keycard) { p.keycard = true; body.keycard = false; this.emit('toast', { text: `${body.name}’s keycard` }); }
      return;
    }
    if (!p.data && dist(p, { x: TERMINAL.x * TILE, y: TERMINAL.y * TILE + 10 }) < 26) { p.action = { kind: 'hack', t: this.mission.progress.hack, need: 4 }; return; }
    if (!this.net.camerasOff && dist(p, { x: PANEL.x * TILE + 8, y: PANEL.y * TILE + 8 }) < 24) { p.action = { kind: 'panel', t: this.mission.progress.panel, need: 1.6 }; return; }
    if (this.keycardOnDesk && dist(p, { x: KEYCARD.x * TILE, y: KEYCARD.y * TILE }) < 22) {
      this.keycardOnDesk = false; p.keycard = true;
      this.emit('toast', { text: 'lab keycard' });
      return;
    }
    const locker = this.lockerNear(p, 20);
    if (locker && !locker.body && !locker.player) { this.enterLocker(locker); return; }
    const guard = this.guards.find(g => !g.down && dist(g, p) < 22);
    if (guard) this.emit('hint', { text: 'get behind a guard to take them down' });
  }

  takedownTarget() {
    const p = this.player;
    let best = null, bestD = 21;
    for (const g of this.guards) {
      if (g.down || g.grabbed) continue;
      const d = dist(g, p);
      if (d >= bestD) continue;
      const off = Math.abs(wrapAngle(angleTo(g.x, g.y, p.x, p.y) - g.facing));
      const aware = g.sees || g.meter > .8;
      if (aware || off < this.rules.fov / 2 + .3) continue;
      if (!walkableLine(p.x, p.y, g.x, g.y, this.playerPassable, PLAYER_R)) continue;
      best = g; bestD = d;
    }
    return best;
  }

  updateAction(dt, input) {
    const p = this.player, action = p.action;
    p.moving = false; p.speed = 0; p.vx = 0; p.vy = 0;
    if (action.kind === 'kill') {
      const g = this.guards.find(item => item.id === action.target);
      if (!g || g.dead) { p.action = null; return; }
      action.t += dt;
      p.facing = angleTo(p.x, p.y, g.x, g.y);
      if (action.t >= action.need) {
        g.grabbed = false;
        this.killGuard(g, 'knife');
        p.action = null;
      }
      return;
    }
    if (action.kind === 'takedown') {
      const g = this.guards.find(item => item.id === action.target);
      if (!g || g.down) { p.action = null; return; }
      action.t += dt;
      p.facing = angleTo(p.x, p.y, g.x, g.y);
      if (action.t >= action.need) {
        g.grabbed = false; this.knockOut(g);
        p.action = null;
      }
      return;
    }
    const moving = Math.hypot(input.move?.x || 0, input.move?.y || 0) > .5;
    if (!input.interactHeld || moving) {
      // Progress is kept: holding E again carries on from here.
      this.mission.progress[action.kind] = action.t;
      p.action = null;
      this.emit('hint', { text: `${action.kind === 'hack' ? 'download' : 'panel'} paused at ${Math.round(action.t / action.need * 100)}% · hold E to continue` });
      return;
    }
    action.t += dt;
    if (action.t < action.need) return;
    p.action = null;
    if (action.kind === 'hack') {
      p.data = true;
      this.mission.breachAt = this.t;
      this.emit('toast', { text: 'data secured · reach the helipad' });
      this.emit('objective', { text: 'Extract at the helipad' });
    } else if (action.kind === 'panel') {
      this.net.camerasOff = true;
      for (const camera of this.cameras) { camera.on = false; camera.meter = 0; }
      this.mission.panelAt = this.t;
      this.emit('toast', { text: 'cameras offline' });
    }
  }

  knockOut(g) {
    if (g.dead) return;
    g.down = true; g.grabbed = false; g.sees = false; g.meter = 0; g.state = 'down'; g.task = null; g.pendingTask = null; g.path = [];
    g.bodyClaimed = null;
    for (const other of this.guards) {
      if (other.bodyTarget === g.id) other.bodyTarget = null;
      if (other.bodyClaimed === g.id) other.bodyClaimed = null;
    }
    g.indicator = 'z'; g.indicatorAt = this.t; g.lastAction = 'unconscious';
    this.metrics.takedowns++;
    this.noise(g.x, g.y, 1.6, 'a scuffle', 'scuffle');
    if (g.keycard && !this.player.keycard) { this.player.keycard = true; g.keycard = false; this.emit('toast', { text: `${g.name}’s keycard` }); }
    this.emit('takedown', { guard: g.id });
  }

  dropBody() {
    const p = this.player, body = this.guards.find(g => g.id === p.carrying);
    p.carrying = null;
    if (!body) return;
    body.carried = false;
    const locker = this.lockerNear(p, 22);
    if (locker && !locker.body && !locker.player) {
      locker.body = body.id; body.hidden = true;
      body.x = locker.x * TILE + 8; body.y = locker.y * TILE + 8;
      this.emit('toast', { text: `${body.name} stowed in a locker` });
      return;
    }
    const kind = kindAt(toTile(body.x), toTile(body.y));
    if (!guardWalk(toTile(body.x), toTile(body.y)) && kind.walk !== 'crouch') { body.x = p.x; body.y = p.y; }
    body.hidden = kind.hide === 'duct';
  }

  lockerNear(point, range) {
    let best = null, bestD = range;
    for (const locker of this.lockers.values()) {
      const d = Math.hypot(locker.x * TILE + 8 - point.x, locker.y * TILE + 8 - point.y);
      if (d < bestD + 8) { best = locker; bestD = d - 8; }
    }
    return best;
  }
  enterLocker(locker) {
    const p = this.player;
    p.locker = { key: index(locker.x, locker.y), from: { x: p.x, y: p.y } };
    locker.player = true;
    p.x = locker.x * TILE + 8; p.y = locker.y * TILE + 8; p.vx = 0; p.vy = 0;
    p.hidden = 'locker'; p.crouch = false;
    // Anyone watching saw which locker it was.
    for (const g of this.guards) {
      if (g.down || !(g.sees || g.meter > .6)) continue;
      if (!lineClear(g.x, g.y, p.x, p.y, this.doorOpen, false)) continue;
      g.sawHide = { key: p.locker.key, at: this.t };
      g.lockerCheck = { key: p.locker.key, t: 0, approach: spotApproach(locker) };
      g.lastAction = 'saw the intruder hide in a locker';
    }
    this.emit('toast', { text: 'hiding in a locker' });
  }
  leaveLocker(forced = false) {
    const p = this.player;
    if (!p.locker) return;
    const locker = this.lockers.get(p.locker.key);
    if (locker) locker.player = false;
    p.x = p.locker.from.x; p.y = p.locker.from.y; p.vx = 0; p.vy = 0;
    p.locker = null; p.hidden = null;
    if (forced) this.emit('toast', { text: 'pulled out of the locker' });
  }

  /* ── world ─────────────────────────────────────────────────────────────── */

  updateDoors(dt) {
    const p = this.player;
    for (const door of this.doors.values()) {
      const cx = door.tx * TILE + 8, cy = door.ty * TILE + 8;
      let want = false;
      if (!p.locker && Math.hypot(p.x - cx, p.y - cy) < 21 && (!door.locked || p.keycard)) want = true;
      if (!want) for (const g of this.guards) if (!g.down && Math.hypot(g.x - cx, g.y - cy) < 23) { want = true; break; }
      if (!want) for (const g of this.guards) if (g.down && toTile(g.x) === door.tx && toTile(g.y) === door.ty) { want = true; break; }
      door.open = Math.max(0, Math.min(1, door.open + (want ? 4.5 : -2.2) * dt));
    }
  }

  updateCameras(dt) {
    const p = this.player;
    for (const camera of this.cameras) {
      if (!camera.on) continue;
      const sweep = camera.facing + Math.sin(this.t * Math.PI * 2 / camera.period + camera.phase) * camera.sweep;
      if (camera.track > 0 && camera.lastSeen) {
        camera.track -= dt;
        camera.angle = turnToward(camera.angle, angleTo(camera.x, camera.y, camera.lastSeen.x, camera.lastSeen.y), 1.6 * dt);
      } else camera.angle = turnToward(camera.angle, sweep, 1.2 * dt);
      const seen = this.canSee(camera, p, camera.range, .52, 0);
      if (seen > 0) {
        camera.lastSeen = { x: p.x, y: p.y, t: this.t };
        camera.meter = Math.min(1.2, camera.meter + dt * 1.9 * this.rules.detect * seen * LEVEL_DETECT[this.net.level]);
        if (camera.meter >= 1) {
          camera.track = 2.5;
          if (!camera.reportedAt || this.t - camera.reportedAt > 1) {
            camera.reportedAt = this.t;
            this.metrics.sightings++;
            if (!camera.alarmed) { camera.alarmed = true; this.metrics.cameraSightings++; this.say('Security', `${camera.name} has the intruder.`, 'alert'); }
            this.send({ kind: 'sighting', from: camera.id, x: p.x, y: p.y, at: this.t, heading: p.facing, pace: this.pace(), camera: true }, .35);
          }
        }
      } else {
        camera.meter = Math.max(0, camera.meter - dt * .6);
        if (camera.meter < .2) camera.alarmed = false;
      }
    }
  }

  pace() { const p = this.player; return p.running ? 'running' : p.crouch ? 'crawling' : p.moving ? 'walking' : 'still'; }

  /** 0 when the observer cannot see the target; otherwise a visibility factor. */
  canSee(viewer, p, range, halfFov, peripheral) {
    if (p.hidden === 'locker' || p.hidden === 'duct') return 0;
    const d = Math.hypot(p.x - viewer.x, p.y - viewer.y);
    if (d > range) return 0;
    const facing = viewer.angle ?? viewer.facing;
    const off = Math.abs(wrapAngle(angleTo(viewer.x, viewer.y, p.x, p.y) - facing));
    const inCone = off <= halfFov;
    const inSide = peripheral > 0 && d <= peripheral && off <= 2.1;
    if (!inCone && !inSide) return 0;
    const low = p.crouch || p.hidden === 'grass';
    if (!lineClear(viewer.x, viewer.y, p.x, p.y, this.doorOpen, low)) return 0;
    let visibility = p.visibility;
    if (p.hidden === 'grass' && d < 1.7 * TILE) visibility = Math.max(visibility, .7);
    const falloff = Math.max(.12, 1 - Math.pow(d / range, 2) * .88);
    return visibility * falloff * (inCone ? 1 : .45);
  }

  /** Sound spreads through open tiles; guards that can hear it react. */
  noise(x, y, radius, label, kind) {
    this.rings.push({ x, y, r: radius * TILE, age: 0, life: .75, kind });
    this.metrics.noises++;
    const reach = soundField(x, y, radius * this.rules.hearing, this.doorOpen);
    for (const g of this.guards) {
      if (g.down || g.grabbed) continue;
      const d = reach.get(index(toTile(g.x), toTile(g.y)));
      if (d == null) continue;
      const fuzz = (.3 + d * .2) * TILE;
      const heard = { x: x + (this.random() * 2 - 1) * fuzz, y: y + (this.random() * 2 - 1) * fuzz, label, kind, loud: radius, at: this.t, dist: d };
      this.hear(g, heard);
    }
  }

  hear(g, heard) {
    if (g.sees) return;
    if (['alert', 'search', 'lockdown'].includes(g.state) && this.net.phase !== 'calm') {
      // Already hunting: a sound nearby is a cue worth checking at once.
      if (heard.dist < 9 && g.task?.role !== 'guard') {
        g.cue = { x: heard.x, y: heard.y, until: this.t + 6 };
        this.setPath(g, heard);
        g.lastAction = 'checking ' + heard.label;
      }
      this.reportEvidence(g, { kind: 'noise', x: heard.x, y: heard.y, label: heard.label, loud: heard.loud }, true);
      return;
    }
    if (g.state === 'investigate' && g.task && Math.hypot(g.task.x - heard.x, g.task.y - heard.y) < 4 * TILE) {
      g.task.x = heard.x; g.task.y = heard.y; g.path = [];
      return;
    }
    g.state = 'suspicious';
    g.reaction = heard.kind === 'gunshot' ? .22 + this.random() * .12 : this.rules.reaction + this.random() * .35;
    g.cue = { x: heard.x, y: heard.y, label: heard.label, loud: heard.loud, until: this.t + 8 };
    g.indicator = '?'; g.indicatorAt = this.t;
    g.lastAction = 'heard ' + heard.label;
    g.path = [];
  }

  /* ── perception ────────────────────────────────────────────────────────── */

  perceive(g, dt) {
    if (g.down || g.grabbed) { g.sees = false; return; }
    const p = this.player, rules = this.rules;
    const range = rules.range * TILE * (g.groggy > 0 ? .7 : 1);
    const seen = this.canSee(g, p, range, rules.fov / 2, rules.peripheral * TILE);
    const hunting = ['alert', 'search', 'lockdown'].includes(g.state);
    const phaseBoost = this.net.phase === 'calm' ? 1 : this.net.phase === 'caution' || this.net.phase === 'returning' ? 1.12 : 1.2;
    const boost = (g.sees ? 2.6 : hunting ? 1.65 : g.state === 'suspicious' || g.state === 'investigate' ? 1.3 : 1) * phaseBoost * LEVEL_DETECT[this.net.level];
    if (seen > 0) {
      g.meter = Math.min(1.2, g.meter + dt * 2.4 * rules.detect * seen * boost * (g.groggy > 0 ? .6 : 1));
      if (g.meter >= 1) this.spot(g);
      else if (g.meter >= .34 && !g.sees && !hunting && g.state !== 'suspicious') {
        g.state = 'suspicious';
        g.reaction = rules.reaction * .8;
        g.cue = { x: p.x, y: p.y, label: 'movement', loud: 0, until: this.t + 6, seen: true };
        g.indicator = '?'; g.indicatorAt = this.t;
        g.lastAction = 'saw movement';
        g.path = [];
      } else if (g.meter >= .34 && g.state === 'suspicious' && g.cue) { g.cue.x = p.x; g.cue.y = p.y; g.cue.seen = true; }
    } else {
      g.meter = Math.max(0, g.meter - dt * (g.sees ? .3 : .45));
      if (g.sees) {
        g.lostFor += dt;
        if (g.lostFor > .6) { g.sees = false; this.emit('lost', { guard: g.id }); }
      }
    }
    if (g.sees && seen > 0) {
      g.lostFor = 0;
      g.lastSeen = { x: p.x, y: p.y, t: this.t, heading: p.facing, pace: this.pace() };
      g.knowledge = { source: 'eyes', x: p.x, y: p.y, t: this.t };
    }
    if (g.reportIn > 0) {
      g.reportIn -= dt;
      if (g.reportIn <= 0) {
        g.reported = true;
        this.say(g.name, `Contact! ${ZONE_BY_ID[zoneAt(g.lastSeen.x, g.lastSeen.y)]?.name || 'here'}.`, 'alert');
        this.send({ kind: 'sighting', from: g.id, ...g.lastSeen, at: g.lastSeen.t }, rules.radio);
        g.nextUpdate = this.t + 1;
      }
    } else if (g.sees && g.reported && this.t >= g.nextUpdate) {
      g.nextUpdate = this.t + 1;
      this.send({ kind: 'sighting', from: g.id, ...g.lastSeen, at: g.lastSeen.t }, rules.radio * .6);
    }
    this.perceiveBodies(g, dt);
  }

  spot(g) {
    const p = this.player;
    if (g.sees) return;
    const wasHunting = ['alert', 'search', 'lockdown'].includes(g.state) || this.net.phase === 'alert' || this.net.phase === 'search';
    // An interception means a dispatched guard reached its blocking position
    // ahead of the player and then reacquired them after visual contact broke.
    const task = g.task;
    if (['alert', 'search'].includes(this.net.phase) && task?.role === 'intercept' && task.decision != null
      && Number.isFinite(task.arrived) && this.t - task.arrived >= .25 && dist(g, task) <= 2 * TILE
      && this.net.lastSeen && this.t - this.net.lastSeen.at > .6
      && !this.guards.some(other => other !== g && !other.down && other.sees)
      && !this.cameras.some(camera => camera.on && camera.lastSeen && this.t - camera.lastSeen.t < .6)) this.metrics.interceptions++;
    g.sees = true; g.lostFor = 0; g.state = 'alert';
    // The classic beat of surprise: a guard freezes before reacting, which is the player's window.
    g.spottedAt = this.t;
    g.freeze = wasHunting ? this.rules.reaction * .45 : this.rules.reaction;
    g.lastSeen = { x: p.x, y: p.y, t: this.t, heading: p.facing, pace: this.pace() };
    g.knowledge = { source: 'eyes', x: p.x, y: p.y, t: this.t };
    g.indicator = '!'; g.indicatorAt = this.t;
    g.lastAction = 'spotted the intruder';
    g.task = { role: 'pursue', x: p.x, y: p.y, label: 'chase on sight', source: 'reflex', issued: this.t };
    this.metrics.sightings++;
    if (!g.reported || this.t - (g.lastSeenReport || -9) > 6) {
      g.reported = false;
      g.reportIn = wasHunting ? this.rules.report * .5 : this.rules.report;
    }
    g.lastSeenReport = this.t;
    this.emit('spotted', { guard: g.id });
  }

  perceiveBodies(g, dt) {
    if (g.sees || g.state === 'alert') return;
    let target = null;
    for (const other of this.guards) {
      if (!other.down || other.hidden || other.carried || other === g || this.net.found.has(other.id) && other.bodyClaimed) continue;
      if (other.bodyClaimed && other.bodyClaimed !== g.id) continue;
      const d = dist(g, other);
      const dark = lightAt(other.x, other.y) < .22 ? .55 : 1;
      if (d > this.rules.range * TILE * .85 * dark) continue;
      const off = Math.abs(wrapAngle(angleTo(g.x, g.y, other.x, other.y) - g.facing));
      if (off > this.rules.fov / 2 + .1) continue;
      if (!lineClear(g.x, g.y, other.x, other.y, this.doorOpen, true)) continue;
      target = other; break;
    }
    if (!target) { g.bodyMeter = Math.max(0, g.bodyMeter - dt); return; }
    g.bodyMeter += dt;
    if (g.bodyMeter < .5 || g.bodyTarget === target.id) return;
    g.bodyTarget = target.id;
    target.bodyClaimed = g.id;
    const dead = Boolean(target.dead);
    g.state = 'investigate';
    g.task = dead
      ? { role: 'investigate', x: target.x, y: target.y, label: 'check the body of ' + target.name, source: 'reflex', issued: this.t }
      : { role: 'revive', x: target.x, y: target.y, target: target.id, label: 'check on ' + target.name, source: 'reflex', issued: this.t };
    g.indicator = '!'; g.indicatorAt = this.t;
    g.lastAction = 'saw ' + target.name + (dead ? ' dead' : ' down');
    g.path = [];
    this.say(g.name, dead ? `${target.name} is dead! ${ZONE_BY_ID[zoneAt(target.x, target.y)]?.name || ''}.` : `${target.name} is down! ${ZONE_BY_ID[zoneAt(target.x, target.y)]?.name || ''}.`, 'alert');
    this.reportEvidence(g, { kind: dead ? 'corpse' : 'body', x: target.x, y: target.y, label: target.name + (dead ? ' found dead' : ' found unconscious'), guard: target.id }, true);
  }

  /* ── guard behaviour ───────────────────────────────────────────────────── */

  think(g, dt) {
    g.anim += dt;
    if (g.down) { g.moving = false; return; }
    if (g.grabbed) { g.moving = false; return; }
    if (g.groggy > 0) g.groggy -= dt;
    if (g.pendingTask && this.t >= g.pendingTask.deliverAt) {
      const task = g.pendingTask; g.pendingTask = null;
      if (!g.sees) this.assign(g, task);
      g.ackDue = null;
    }
    if (g.sees) { this.chase(g, dt); return; }
    if (g.state === 'suspicious') { this.suspicious(g, dt); return; }
    if (g.lockerCheck) { this.checkLocker(g, dt); return; }
    const task = g.task;
    if (g.cue && this.t < g.cue.until && ['alert', 'search', 'lockdown'].includes(g.state) && task?.role !== 'guard') {
      if (this.travel(g, g.cue, this.speedFor(g), dt)) { this.lookAround(g, dt, 1.2); if (!g.scanEnd) g.scanEnd = this.t + 1.6; if (this.t > g.scanEnd) { g.cue = null; g.scanEnd = 0; g.path = []; } }
      return;
    }
    if (!task) { this.patrol(g, dt); return; }
    switch (task.role) {
      case 'pursue': this.pursue(g, dt); break;
      case 'intercept': case 'block': case 'guard': case 'post': this.holdPost(g, dt); break;
      case 'search': this.search(g, dt); break;
      case 'probe': this.probe(g, dt); break;
      case 'investigate': this.investigate(g, dt); break;
      case 'revive': this.revive(g, dt); break;
      case 'panel': this.fixPanel(g, dt); break;
      case 'return': default: this.returnToRoute(g, dt);
    }
  }

  speedFor(g) {
    const base = g.sees || g.task?.role === 'pursue' && g.state === 'alert' ? this.rules.chase : STATE_SPEED[g.state] ?? 40;
    const level = this.net.level >= 3 ? 1.08 : 1;
    return base * level * (g.groggy > 0 ? .7 : 1);
  }

  setPath(g, goal, cost = null) {
    const sx = toTile(g.x), sy = toTile(g.y), gx = toTile(goal.x), gy = toTile(goal.y);
    const tiles = findPath(sx, sy, gx, gy, this.guardPassable, cost);
    g.path = tiles ? smoothPath(tiles, this.guardPassable, GUARD_R) : [];
    if (g.path.length && !this.blocked(goal.x, goal.y, GUARD_R, this.guardPassable)) {
      const before = g.path[g.path.length - 2] || g;
      if (walkableLine(before.x, before.y, goal.x, goal.y, this.guardPassable, GUARD_R)) g.path[g.path.length - 1] = { x: goal.x, y: goal.y };
      else g.path.push({ x: goal.x, y: goal.y });
    }
    // Tile-centre smoothing cannot assume the body is at that centre. Keep
    // the first waypoint when skipping it would clip a crate or wall corner.
    if (g.path.length > 1 && walkableLine(g.x, g.y, g.path[1].x, g.path[1].y, this.guardPassable, GUARD_R)) g.path.shift();
    g.pathGoal = { x: goal.x, y: goal.y };
    g.pathAge = this.t;
  }

  /** Walks toward a goal along an A* path. True on arrival. */
  travel(g, goal, speed, dt, cost = null) {
    if (!g.pathGoal || Math.hypot(g.pathGoal.x - goal.x, g.pathGoal.y - goal.y) > TILE * .9 || (!g.path.length && dist(g, goal) > 10) || this.t - g.pathAge > 6) this.setPath(g, goal, cost);
    if (!g.path.length) { g.moving = false; return dist(g, goal) < 12 || !this.reachable(g, goal); }
    const next = g.path[0];
    const dx = next.x - g.x, dy = next.y - g.y, d = Math.hypot(dx, dy);
    if (d < 3) { g.path.shift(); if (!g.path.length) { g.moving = false; return true; } return false; }
    const want = Math.atan2(dy, dx);
    g.facing = turnToward(g.facing, want, this.rules.turn * dt * (g.state === 'alert' ? 1.6 : 1));
    const step = Math.min(d, speed * dt);
    const tx = toTile(g.x + dx / d * (GUARD_R + 4)), ty = toTile(g.y + dy / d * (GUARD_R + 4));
    if (this.guardBlocked(tx, ty) && guardWalk(tx, ty)) { g.moving = false; return false; }
    const before = { x: g.x, y: g.y };
    this.moveBody(g, dx / d * step, dy / d * step, GUARD_R, (x, y) => !this.guardBlocked(x, y));
    const moved = Math.hypot(g.x - before.x, g.y - before.y);
    g.moving = moved > .01;
    if (moved < step * .2) { g.stuck += dt; if (g.stuck > .8) { g.stuck = 0; this.setPath(g, goal, cost); } } else g.stuck = 0;
    return false;
  }
  reachable(g, goal) {
    const field = distanceField(toTile(goal.x), toTile(goal.y), guardWalk);
    return Number.isFinite(field[index(toTile(g.x), toTile(g.y))]);
  }

  lookAround(g, dt, amp = 1, center = null) {
    if (!g.scan || (center != null && Math.abs(wrapAngle(g.scan.base - center)) > .3)) g.scan = { base: center ?? g.facing, t: 0 };
    g.scan.t += dt;
    const target = g.scan.base + Math.sin(g.scan.t * 1.25) * amp;
    g.facing = turnToward(g.facing, target, this.rules.turn * dt * .7);
    g.moving = false;
  }

  chase(g, dt) {
    g.state = 'alert';
    const target = g.lastSeen;
    if (!target) { g.sees = false; this.goHome(g); return; }
    if (g.freeze > 0) {
      g.freeze -= dt;
      g.facing = turnToward(g.facing, angleTo(g.x, g.y, target.x, target.y), this.rules.turn * dt * 2);
      g.moving = false; g.lastAction = 'startled';
      return;
    }
    g.lastAction = 'chasing the intruder';
    if (dist(g, target) < this.rules.capture * .7) {
      g.facing = turnToward(g.facing, angleTo(g.x, g.y, target.x, target.y), this.rules.turn * dt * 2);
      g.moving = false;
      return;
    }
    if (lineClear(g.x, g.y, target.x, target.y, this.doorOpen, false) && this.straightWalk(g, target)) {
      const dx = target.x - g.x, dy = target.y - g.y, d = Math.hypot(dx, dy);
      g.facing = turnToward(g.facing, Math.atan2(dy, dx), this.rules.turn * dt * 2);
      const step = Math.min(d, this.rules.chase * dt);
      this.moveBody(g, dx / d * step, dy / d * step, GUARD_R, (x, y) => !this.guardBlocked(x, y));
      g.moving = true; g.path = []; g.pathGoal = null;
      return;
    }
    this.travel(g, target, this.rules.chase, dt);
  }
  straightWalk(g, target) {
    const tx = toTile(target.x), ty = toTile(target.y);
    return guardWalk(tx, ty) && Math.hypot(target.x - g.x, target.y - g.y) < 7 * TILE
      && walkableLine(g.x, g.y, target.x, target.y, (x, y) => !this.guardBlocked(x, y), GUARD_R);
  }

  suspicious(g, dt) {
    const cue = g.cue;
    if (!cue) { g.state = g.task ? (g.task.role === 'return' ? 'returning' : 'patrol') : 'patrol'; return; }
    g.facing = turnToward(g.facing, angleTo(g.x, g.y, cue.x, cue.y), this.rules.turn * dt);
    g.moving = false;
    g.reaction -= dt;
    if (g.reaction > 0) return;
    // Reaction over: report, then check it out unless command says otherwise.
    if (!cue.reported) {
      cue.reported = true;
      const label = cue.seen ? 'movement' : cue.label;
      this.say(g.name, `${cue.seen ? 'Saw' : 'Heard'} ${label} in the ${ZONE_BY_ID[zoneAt(cue.x, cue.y)]?.name || 'area'}. Checking.`, 'caution');
      this.reportEvidence(g, { kind: cue.seen ? 'glimpse' : 'noise', x: cue.x, y: cue.y, label: cue.seen ? 'movement' : cue.label, loud: cue.loud || 0 }, false);
      g.waitOrders = this.mode === 'commander' && !cue.seen ? this.rules.radio * 2 + .4 : 0;
    }
    if (g.waitOrders > 0) { g.waitOrders -= dt; if (g.waitOrders > 0) return; }
    if (g.state !== 'suspicious') return;
    const d = dist(g, cue) / TILE;
    if (cue.seen || d < 8 || this.mode === 'baseline') {
      g.state = 'investigate';
      g.task = { role: 'investigate', x: cue.x, y: cue.y, label: 'check ' + (cue.seen ? 'movement' : cue.label), source: 'reflex', issued: this.t };
      g.path = [];
    } else {
      g.state = 'patrol'; g.task = null; g.indicator = ''; g.lastAction = 'resuming patrol';
    }
    g.cue = null;
  }

  patrol(g, dt) {
    if (g.state !== 'patrol' && g.state !== 'returning') g.state = 'patrol';
    const route = g.route;
    if (!route.length) { this.lookAround(g, dt, .9); return; }
    const point = route[g.routeIndex % route.length];
    if (g.hold > 0) {
      g.hold -= dt;
      this.lookAround(g, dt, .85, point.face ?? g.facing);
      g.lastAction = 'watching';
      if (g.hold <= 0) { g.routeIndex = (g.routeIndex + 1) % route.length; g.scan = null; }
      return;
    }
    if (this.net.posture?.probe && this.maybeCheckLocker(g)) return;
    g.lastAction = route.length === 1 ? 'standing watch' : 'patrolling';
    if (this.travel(g, point, this.speedFor(g), dt)) {
      if (point.hold) { g.hold = point.hold; g.scan = null; }
      else g.routeIndex = (g.routeIndex + 1) % route.length;
    }
    if (g.state === 'returning' && this.t - (g.task?.issued || 0) > 1) { g.state = 'patrol'; }
  }

  maybeCheckLocker(g) {
    if (this.t - g.lastLockerCheck < 14) return false;
    for (const locker of this.lockers.values()) {
      const approach = spotApproach(locker);
      if (Math.hypot(approach.x - g.x, approach.y - g.y) > 20) continue;
      g.lastLockerCheck = this.t;
      if (this.random() > this.rules.probe) return false;
      g.lockerCheck = { key: index(locker.x, locker.y), t: 0, approach };
      return true;
    }
    return false;
  }

  checkLocker(g, dt) {
    const check = g.lockerCheck, locker = this.lockers.get(check.key);
    if (!locker) { g.lockerCheck = null; return; }
    if (!this.travel(g, check.approach, this.speedFor(g) || 40, dt)) return;
    g.facing = turnToward(g.facing, angleTo(g.x, g.y, locker.x * TILE + 8, locker.y * TILE + 8), this.rules.turn * dt);
    check.t += dt;
    g.lastAction = 'opening a locker';
    if (check.t < 1) return;
    g.lockerCheck = null;
    locker.openedAt = this.t;
    this.metrics.lockerChecks++;
    this.net.checked[locker.cluster] = this.t;
    if (locker.player) {
      this.leaveLocker(true);
      this.player.x = check.approach.x + Math.cos(g.facing) * 4; this.player.y = check.approach.y + Math.sin(g.facing) * 4;
      this.metrics.foundHiding++;
      this.metrics.foundIn.push('locker');
      this.say(g.name, 'Found you!', 'alert');
      g.meter = 1;
      this.spot(g);
      g.reportIn = .2;
      this.notePrediction(locker.zone, locker.cluster, true);
    } else if (locker.body) {
      const body = this.guards.find(item => item.id === locker.body);
      locker.body = null;
      if (body) {
        const dead = Boolean(body.dead);
        body.hidden = false; body.x = check.approach.x; body.y = check.approach.y;
        g.task = dead
          ? { role: 'investigate', x: body.x, y: body.y, label: 'check the body of ' + body.name, source: 'reflex', issued: this.t }
          : { role: 'revive', x: body.x, y: body.y, target: body.id, label: 'check on ' + body.name, source: 'reflex', issued: this.t };
        g.state = 'investigate';
        this.say(g.name, dead ? `${body.name} is dead in a locker!` : `${body.name} was stuffed in a locker!`, 'alert');
        this.reportEvidence(g, { kind: dead ? 'corpse' : 'body', x: body.x, y: body.y, label: body.name + (dead ? ' found dead in a locker' : ' found in a locker'), guard: body.id }, true);
      }
    }
  }

  pursue(g, dt) {
    const task = g.task;
    const known = g.knowledge && this.t - g.knowledge.t < 30 ? g.knowledge : task;
    const goal = { x: known.x, y: known.y };
    g.lastAction = 'moving to the last sighting';
    if (this.travel(g, goal, this.rules.chase * .92, dt)) {
      this.lookAround(g, dt, 1.3);
      if (!task.arrived) { task.arrived = this.t; this.net.searched[zoneAt(g.x, g.y)] = this.t; }
      if (this.t - task.arrived > 2.2) {
        // Nothing here: widen into a local search around the sighting.
        const zone = zoneAt(goal.x, goal.y);
        g.task = { role: 'search', zone, x: goal.x, y: goal.y, label: 'search around the sighting', source: task.source, issued: this.t, decision: task.decision };
        g.state = 'search'; g.path = [];
      }
    }
  }

  holdPost(g, dt) {
    const task = g.task;
    const avoid = task.role === 'intercept' && this.net.lastSeen ? this.avoidCost(this.net.lastSeen) : null;
    if (this.travel(g, task, task.role === 'post' ? this.speedFor(g) : this.rules.chase * .85, dt, avoid)) {
      const face = Number.isFinite(task.face) ? task.face : this.net.lastSeen ? angleTo(g.x, g.y, this.net.lastSeen.x, this.net.lastSeen.y) : g.facing;
      this.lookAround(g, dt, task.role === 'post' ? .9 : .55, face);
      g.lastAction = task.role === 'intercept' ? 'in position ahead of the intruder' : task.role === 'post' ? 'standing watch' : 'holding ' + (task.label || 'post').replace(/^(close|block|hold|secure|cover|watch) /, '');
      if (!task.arrived) task.arrived = this.t;
      if (task.role === 'intercept' && this.t - task.arrived > 14 && this.net.phase !== 'alert') { g.task = { ...task, role: 'block' }; }
    } else g.lastAction = task.role === 'intercept' ? 'cutting around to intercept' : 'moving to ' + (task.label || 'a post');
  }

  avoidCost(center) {
    const cx = toTile(center.x), cy = toTile(center.y);
    return (tx, ty) => { const d = Math.hypot(tx - cx, ty - cy); return d < 4 ? (4 - d) * 2.2 : 0; };
  }

  search(g, dt) {
    const task = g.task;
    if (!task.points) {
      const origin = { x: task.x, y: task.y };
      const points = (SEARCH_POINTS[task.zone] || []).slice();
      const hidden = HIDING.filter(spot => spot.zone === task.zone && spot.type === 'locker').map(spot => ({ ...spotApproach(spot), locker: index(spot.x, spot.y) }));
      const all = [...points, ...hidden.filter(() => this.random() < this.rules.probe + .2)];
      all.sort((a, b) => dist(a, origin) - dist(b, origin));
      // Different guards sweeping the same zone start from different ends.
      const twin = this.guards.find(other => other !== g && other.task?.role === 'search' && other.task.zone === task.zone && other.task.points);
      task.points = twin ? all.reverse() : all;
      task.index = 0;
      if (!task.points.length) task.points = [origin];
    }
    if (task.index >= task.points.length) {
      this.lookAround(g, dt, 1.2);
      g.lastAction = 'zone searched · watching';
      if (!task.doneAt) { task.doneAt = this.t; this.net.searched[task.zone] = this.t; this.notePrediction(task.zone, null, false); }
      return;
    }
    const point = task.points[task.index];
    g.lastAction = `searching the ${ZONE_BY_ID[task.zone]?.name || 'area'} (${task.index + 1}/${task.points.length})`;
    if (this.travel(g, point, this.speedFor(g), dt)) {
      if (point.locker != null && !task.opened?.has(point.locker)) {
        task.opened = task.opened || new Set(); task.opened.add(point.locker);
        g.lockerCheck = { key: point.locker, t: 0, approach: point };
        return;
      }
      if (!task.scanUntil) task.scanUntil = this.t + 1.1 + this.random() * .6;
      this.lookAround(g, dt, 1.25);
      if (this.t >= task.scanUntil) { task.scanUntil = 0; task.index++; g.scan = null; }
    }
  }

  probe(g, dt) {
    const task = g.task;
    if (!task.spots) {
      const cluster = HIDING_CLUSTERS.find(item => item.id === task.cluster);
      const spots = (cluster?.spots || []).map(spot => ({ ...spotApproach(spot), spot }));
      spots.sort((a, b) => dist(a, task) - dist(b, task));
      task.spots = spots.slice(0, cluster?.type === 'grass' ? 5 : 6);
      task.index = 0;
    }
    if (task.index >= task.spots.length) {
      this.lookAround(g, dt, 1);
      g.lastAction = 'hiding spots checked';
      if (!task.doneAt) { task.doneAt = this.t; this.net.checked[task.cluster] = this.t; this.notePrediction(null, task.cluster, false); }
      return;
    }
    const target = task.spots[task.index];
    g.lastAction = `checking hiding spots (${task.index + 1}/${task.spots.length})`;
    if (this.travel(g, target, this.speedFor(g), dt)) {
      if (target.spot.type === 'locker') { g.lockerCheck = { key: index(target.spot.x, target.spot.y), t: 0, approach: target }; task.index++; return; }
      if (!task.scanUntil) task.scanUntil = this.t + .9;
      this.lookAround(g, dt, 1.4);
      if (this.t >= task.scanUntil) { task.scanUntil = 0; task.index++; }
    }
  }

  investigate(g, dt) {
    const task = g.task;
    g.state = 'investigate';
    g.lastAction = task.label || 'investigating';
    if (!this.travel(g, task, this.speedFor(g), dt)) return;
    if (!task.arrived) { task.arrived = this.t; g.scan = null; }
    this.lookAround(g, dt, 1.3);
    if (task.locker == null && this.random() < dt * this.rules.probe) {
      const locker = this.lockerNear(g, 30);
      if (locker && !task.opened) { task.opened = true; g.lockerCheck = { key: index(locker.x, locker.y), t: 0, approach: spotApproach(locker) }; return; }
    }
    if (this.t - task.arrived > 3.2) {
      if (task.kind === 'missing') {
        const body = this.guards.find(other => other.id === task.guard);
        if (body && body.down && !body.hidden && dist(g, body) < 6 * TILE) return;
      }
      this.say(g.name, `Nothing at the ${ZONE_BY_ID[zoneAt(task.x, task.y)]?.name || 'spot'}.`, '');
      this.net.searched[zoneAt(task.x, task.y)] = this.t;
      if (task.evidence) task.evidence.cleared = this.t;
      this.goHome(g);
    }
  }

  revive(g, dt) {
    const task = g.task, body = this.guards.find(other => other.id === task.target);
    if (!body || !body.down) { this.goHome(g); return; }
    if (body.dead) {
      // A corpse cannot be revived. The guard confirms the death and returns.
      g.task = { role: 'investigate', x: body.x, y: body.y, label: 'check the body of ' + body.name, source: 'reflex', issued: this.t };
      g.state = 'investigate'; g.path = []; g.scan = null;
      return;
    }
    // A dragged body does not act as a tracking beacon. Follow the last
    // observed location until the guard can actually see it again.
    const visible = !body.hidden && !body.carried && dist(g, body) <= this.rules.range * TILE
      && Math.abs(wrapAngle(angleTo(g.x, g.y, body.x, body.y) - g.facing)) <= this.rules.fov / 2 + .1
      && lineClear(g.x, g.y, body.x, body.y, this.doorOpen, true);
    if (visible) { task.x = body.x; task.y = body.y; }
    g.state = 'investigate';
    if (!this.travel(g, task, this.speedFor(g) * 1.3, dt)) { task.reviveAt = null; g.lastAction = task.label; return; }
    if (!visible || dist(g, body) > 20 || !walkableLine(g.x, g.y, body.x, body.y, this.guardPassable, 0)) {
      task.reviveAt = null;
      this.lookAround(g, dt, 1.4);
      if (task.lookUntil == null) task.lookUntil = this.t + 2.5;
      if (this.t >= task.lookUntil) {
        body.bodyClaimed = null; g.bodyTarget = null;
        g.task = { role: 'investigate', x: task.x, y: task.y, label: 'check where ' + body.name + ' was seen', source: 'reflex', issued: this.t };
        g.path = []; g.scan = null;
      }
      return;
    }
    task.lookUntil = null;
    if (!task.reviveAt) { task.reviveAt = this.t + 3.5; g.lastAction = 'waking ' + body.name; }
    g.facing = turnToward(g.facing, angleTo(g.x, g.y, body.x, body.y), this.rules.turn * dt);
    g.moving = false;
    if (this.t < task.reviveAt) return;
    body.down = false; body.bodyClaimed = null; body.state = 'returning'; body.groggy = 14; body.indicator = ''; body.task = null; body.pendingTask = null;
    for (const other of this.guards) if (other.bodyTarget === body.id) other.bodyTarget = null;
    body.lastAction = 'groggy';
    this.net.found.add(body.id);
    this.net.missing.delete(body.id);
    this.say(body.name, 'Someone choked me out…', 'caution');
    this.goHome(g);
  }

  fixPanel(g, dt) {
    const task = g.task;
    g.state = 'investigate';
    g.lastAction = 'restoring the cameras';
    if (!this.travel(g, task, this.speedFor(g) * 1.2, dt)) return;
    if (!task.at) task.at = this.t;
    this.lookAround(g, dt, .5);
    if (this.t - task.at < 2.2) return;
    this.net.camerasOff = false;
    for (const camera of this.cameras) camera.on = true;
    this.say(g.name, 'Cameras are back up.', '');
    this.goHome(g);
  }

  goHome(g) {
    g.task = { role: 'return', label: 'return to route', source: 'reflex', issued: this.t };
    g.state = 'returning';
    g.indicator = ''; g.path = []; g.scan = null;
  }

  returnToRoute(g, dt) {
    g.state = 'returning';
    g.lastAction = 'returning to route';
    const route = g.route;
    if (!route.length) { g.task = null; return; }
    if (g.task.routePoint == null) {
      let best = 0, bestD = Infinity;
      route.forEach((point, i) => { const d = dist(point, g); if (d < bestD) { bestD = d; best = i; } });
      g.task.routePoint = best;
      g.routeIndex = best;
    }
    if (this.travel(g, route[g.task.routePoint], this.speedFor(g), dt)) { g.task = null; g.state = 'patrol'; }
  }

  separate() {
    const list = this.guards.filter(g => !g.down);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= 11 || d < .01) continue;
      const push = (11 - d) / 2 * .3;
      this.moveBody(a, -dx / d * push, -dy / d * push, GUARD_R, (x, y) => !this.guardBlocked(x, y));
      this.moveBody(b, dx / d * push, dy / d * push, GUARD_R, (x, y) => !this.guardBlocked(x, y));
    }
  }

  /* ── radio and the security network ────────────────────────────────────── */

  send(message, delay) { this.queue.push({ ...message, deliverAt: this.t + delay }); }

  reportEvidence(g, evidence, urgent) {
    this.send({ ...evidence, channel: 'evidence', from: g.id, at: this.t, urgent }, this.rules.radio);
  }

  updateNet(dt) {
    const net = this.net;
    // Deliver radio traffic whose delay has passed.
    const due = this.queue.filter(message => message.deliverAt <= this.t);
    this.queue = this.queue.filter(message => message.deliverAt > this.t);
    for (const message of due) this.receive(message);

    for (const g of this.guards) if (!g.down) g.known = { x: g.x, y: g.y, zone: zoneAt(g.x, g.y), state: g.state, t: this.t };
    // A guard who does not answer an order is presumed in trouble.
    for (const g of this.guards) {
      if (g.ackDue != null && this.t > g.ackDue) {
        g.ackDue = null;
        if (g.down && !net.missing.has(g.id) && !net.found.has(g.id)) this.markMissing(g, 'did not acknowledge orders');
      }
    }
    if (this.t >= net.nextCheckin) {
      net.nextCheckin = this.t + this.rules.checkin;
      const silent = this.guards.filter(g => g.down && !net.missing.has(g.id) && !net.found.has(g.id));
      if (silent.length) this.say('Command', 'Radio check…', '');
      for (const g of silent) this.markMissing(g, 'missed the radio check');
    }
    if (this.mission.breachAt != null && !net.breach && this.t - this.mission.breachAt >= this.rules.breach) {
      net.breach = true;
      this.say('Security', 'Intrusion alarm on the lab server: data copied.', 'alert');
      this.evidence({ kind: 'breach', x: TERMINAL.x * TILE, y: TERMINAL.y * TILE + 16, label: 'the data breach', at: this.t, urgent: true });
    }
    if (this.mission.panelAt != null && !net.camerasNoticed && this.t - this.mission.panelAt >= this.rules.panelNotice && net.camerasOff) {
      net.camerasNoticed = true;
      this.say('Security', 'Camera feeds are down.', 'caution');
      this.evidence({ kind: 'cameras', x: PANEL.x * TILE + 8, y: PANEL.y * TILE + 24, label: 'the camera outage', at: this.t, urgent: false });
    }
    if (!this.keycardOnDesk && !net.keycardMissing) {
      for (const g of this.guards) {
        if (g.down || dist(g, { x: KEYCARD.x * TILE, y: KEYCARD.y * TILE }) > 4 * TILE) continue;
        if (!lineClear(g.x, g.y, KEYCARD.x * TILE, KEYCARD.y * TILE, this.doorOpen, false)) continue;
        net.keycardMissing = true;
        this.say(g.name, 'The lab keycard is gone from the office.', 'caution');
        this.evidence({ kind: 'keycard', x: KEYCARD.x * TILE, y: KEYCARD.y * TILE, label: 'the missing keycard', at: this.t, urgent: false });
        break;
      }
    }

    // Phase transitions.
    const sinceSeen = net.lastSeen ? this.t - net.lastSeen.at : Infinity;
    const anyEyes = this.guards.some(g => g.sees) || this.cameras.some(camera => camera.on && camera.track > 0);
    if (net.phase === 'alert') {
      this.metrics.alertTime += dt;
      if (!anyEyes && sinceSeen > 3) this.loseContact();
      else if (this.mode === 'commander' && this.t - net.lastDecisionAt > this.rules.replan && net.lastSeen && zoneAt(net.lastSeen.x, net.lastSeen.y) !== net.decisionZone) this.decide('contact', null);
    } else if (net.phase === 'search') {
      this.metrics.alertTime += dt;
      if (this.t >= net.searchUntil) this.endSearch();
      else if (this.mode === 'commander' && this.t >= net.nextSweep && this.t - net.lastDecisionAt > this.rules.gap) this.decide('sweep', null);
    } else if (net.phase === 'lockdown') {
      if (this.t >= net.lockdownUntil) this.setPhase('returning');
    } else if (net.phase === 'returning' || net.phase === 'caution') {
      if (this.t - net.phaseSince > (net.phase === 'returning' ? 14 : 30) && this.t - (net.lastEvidenceAt || 0) > 20) this.setPhase(net.phase === 'returning' ? 'caution' : 'calm');
    }
    if (net.postureDue && this.t >= net.postureDue && net.phase !== 'alert' && net.phase !== 'search' && this.t - net.lastDecisionAt >= this.rules.gap) {
      net.postureDue = 0;
      this.say('Command', 'Security failures logged. Rearranging patrols.', 'caution');
      this.decide('posture', { kind: 'escalation' });
    }
    if (net.pendingAnomaly && this.t - net.lastDecisionAt >= this.rules.gap) {
      const event = net.pendingAnomaly; net.pendingAnomaly = null;
      if (net.phase !== 'alert' && net.phase !== 'search') this.decide('anomaly', event);
    }
  }

  setPhase(phase) {
    const net = this.net;
    if (net.phase === phase) return;
    const before = net.phase;
    net.phase = phase; net.phaseSince = this.t;
    this.emit('phase', { phase, before });
    if (phase === 'returning') {
      this.say('Command', 'Stand down. Return to your routes, stay sharp.', '');
      for (const g of this.guards) if (!g.down && !g.sees && g.task && g.task.role !== 'post') this.goHome(g);
      if (this.mode === 'commander') net.level = Math.max(1, Math.min(net.level, 2));
    }
    if (phase === 'calm') net.level = this.mode === 'commander' ? Math.max(1, net.posture?.level ?? 1) : 1;
  }

  receive(message) {
    const net = this.net;
    if (message.channel !== 'evidence' && message.kind === 'sighting') {
      const from = this.guards.find(g => g.id === message.from);
      if (from && from.down) return;
      const first = net.phase !== 'alert';
      const zone = zoneAt(message.x, message.y);
      net.lastSeen = { x: message.x, y: message.y, at: message.at, zone, heading: message.heading, pace: message.pace, from: message.from };
      net.sightings.unshift({ zone, at: message.at, x: message.x, y: message.y });
      net.sightings.length = Math.min(net.sightings.length, 8);
      for (const g of this.guards) if (!g.down && (!g.knowledge || g.knowledge.source !== 'eyes' || this.t - g.knowledge.t > 1.5)) g.knowledge = { source: 'radio', x: message.x, y: message.y, t: message.at };
      if (first) {
        if (net.lostEpisode) {
          const episode = net.lostEpisode;
          this.metrics.reacquired++;
          this.metrics.reacquireTimes.push(this.t - episode.at);
          const fromZone = episode.zone;
          if (zone !== fromZone) this.metrics.escapes.push(zone);
          const moved = Math.hypot(message.x - episode.x, message.y - episode.y) / TILE;
          this.metrics.afterDetect.push(moved < 6 && this.t - episode.at > 5 ? 'hid' : 'fled');
          net.lostEpisode = null;
        } else {
          this.metrics.alerts++;
          net.alertEpisode = { at: this.t };
        }
        this.notePrediction(zone, null, true);
        this.setPhase('alert');
        net.level = 3;
        this.say('Command', `All units: intruder sighted, ${ZONE_BY_ID[zone]?.name || 'inside'}.`, 'alert');
        this.emit('alarm', { zone });
        // Everyone hears the broadcast: the two closest head over at once, before command assigns roles.
        if (this.mode === 'commander') {
          for (const g of this.nearestGuards(net.lastSeen, 2, other => !other.objective && !net.missing.has(other.id) && !other.task?.role?.match(/^(guard|revive)$/))) {
            if (!g.down) this.assign(g, { role: 'pursue', x: message.x, y: message.y, label: 'respond to the broadcast', source: 'broadcast' });
          }
        }
        this.decide('contact', null);
      } else if (net.prediction && net.prediction.zone && zone !== net.prediction.zone && !this.adjacentZone(zone, net.prediction.zone) && this.t - net.lastDecisionAt > 1.2) {
        this.notePrediction(zone, null, true);
        this.decide('contact', null);
      }
      return;
    }
    if (message.channel === 'evidence') this.evidence(message);
  }

  adjacentZone(a, b) {
    return a === b || ZONE_BY_ID[a] && ZONE_BY_ID[b] && ZONE_BY_ID[a].id && this.zoneNeighbours(a).includes(b);
  }
  zoneNeighbours(zone) {
    this._neighbours = this._neighbours || {};
    if (!this._neighbours[zone]) {
      const list = [];
      for (const other of ZONES) if (other.id !== zone && this.portalBetween(zone, other.id)) list.push(other.id);
      this._neighbours[zone] = list;
    }
    return this._neighbours[zone];
  }
  portalBetween(a, b) { return PORTALS.some(p => (p.a === a && p.b === b) || (p.a === b && p.b === a)); }

  evidence(message) {
    const net = this.net;
    const zone = zoneAt(message.x, message.y);
    const item = { kind: message.kind, x: message.x, y: message.y, zone, at: message.at ?? this.t, label: message.label, from: message.from, loud: message.loud, guard: message.guard };
    // Repeated noises close together are one event.
    const same = net.evidence.find(other => other.kind === item.kind && other.zone === zone && this.t - other.at < 6 && Math.hypot(other.x - item.x, other.y - item.y) < 5 * TILE);
    if (same) { same.at = item.at; same.x = item.x; same.y = item.y; same.count = (same.count || 1) + 1; }
    else { net.evidence.unshift(item); net.evidence.length = Math.min(net.evidence.length, 12); }
    net.lastEvidenceAt = this.t;
    if (item.kind === 'body') { this.metrics.bodiesFound++; if (item.guard) { net.found.add(item.guard); net.missing.delete(item.guard); } }
    if (item.kind === 'corpse') { this.metrics.bodiesFound++; this.metrics.corpsesFound = (this.metrics.corpsesFound || 0) + 1; if (item.guard) { net.found.add(item.guard); net.missing.delete(item.guard); } }
    if (net.prediction && (item.kind === 'noise' || item.kind === 'glimpse')) this.notePrediction(zone, null, true);
    const serious = ['body', 'corpse', 'missing', 'breach', 'keycard', 'cameras'].includes(item.kind);
    if (this.mode === 'baseline') { this.baselineEvidence(item, message); return; }
    if (net.phase === 'alert') return;
    if (net.phase === 'search') {
      if ((item.kind === 'noise' || item.kind === 'glimpse' || serious) && this.t - net.lastDecisionAt > 1) { net.lastClue = item; this.decide('sweep', item); }
      return;
    }
    if (same && !serious) return;
    if (this.t - net.lastDecisionAt < this.rules.gap && !serious) { net.pendingAnomaly = item; return; }
    this.decide('anomaly', item);
  }

  markMissing(g, why) {
    const net = this.net;
    net.missing.add(g.id);
    this.metrics.missingNoticed++;
    const last = g.known || { x: g.x, y: g.y };
    this.say('Command', `${g.name} ${why}.`, 'caution');
    this.evidence({ kind: 'missing', x: last.x, y: last.y, label: g.name + ' not responding', guard: g.id, at: this.t, urgent: true });
  }

  loseContact() {
    const net = this.net;
    this.setPhase('search');
    net.searchUntil = this.t + this.rules.search;
    net.lostAt = this.t;
    const lkp = net.lastSeen;
    net.lostEpisode = lkp ? { at: this.t, zone: lkp.zone, x: lkp.x, y: lkp.y } : null;
    this.metrics.searches++;
    if (lkp) {
      const near = HIDING_CLUSTERS.map(cluster => ({ cluster, d: Math.hypot(cluster.x * TILE - lkp.x, cluster.y * TILE - lkp.y) })).sort((a, b) => a.d - b.d)[0];
      this.metrics.vanish.push(near && near.d < 6 * TILE ? near.cluster.id : lkp.zone);
    }
    this.say('Command', 'Lost contact. Search pattern.', 'caution');
    if (this.mode === 'commander') this.decide('lost', null);
    else this.baselineLost();
  }

  endSearch() {
    const net = this.net;
    if (net.lostEpisode) { this.metrics.recoveries++; net.lostEpisode = null; }
    net.alertEpisode = null;
    if (this.mode === 'commander') {
      this.setPhase('lockdown');
      net.lockdownUntil = this.t + this.rules.lockdown;
      this.say('Command', 'Search over. Hold the key posts.', 'caution');
      this.decide('posture', { kind: 'stand_down' });
    } else this.setPhase('returning');
  }

  notePrediction(zone, cluster, evidence) {
    const prediction = this.net.prediction;
    if (!prediction || prediction.resolved) return;
    if (evidence) {
      const hit = (zone && (zone === prediction.zone || (prediction.exitTo && zone === prediction.exitTo))) || (cluster && cluster === prediction.cluster);
      prediction.resolved = hit ? 'hit' : 'miss';
      if (hit) this.metrics.predictionsHit++; else this.metrics.predictionsMiss++;
      this.net.planStatus = hit ? 'confirmed by fresh evidence' : `contradicted: evidence in the ${ZONE_BY_ID[zone]?.name || zone}`;
      if (!hit) this.emit('misread', { zone, predicted: prediction.zone });
    } else if ((zone && zone === prediction.zone) || (cluster && cluster === prediction.cluster)) {
      prediction.cleared = (prediction.cleared || 0) + 1;
      this.net.planStatus = `predicted ${cluster ? 'hiding spots' : 'area'} searched, nothing found`;
      if (prediction.cleared >= (prediction.cluster ? 1 : 2) && !prediction.resolved) {
        prediction.resolved = 'miss';
        this.metrics.predictionsMiss++;
        if (this.net.phase === 'search' && this.t - this.net.lastDecisionAt > this.rules.gap) { this.net.nextSweep = this.t; }
      }
    }
  }

  /* ── baseline security (no commander) ──────────────────────────────────── */

  baselineEvidence(item) {
    const net = this.net;
    if (['body', 'missing', 'breach', 'keycard', 'cameras'].includes(item.kind)) {
      if (net.phase === 'calm') this.setPhase('caution');
      net.level = 2;
      const responders = this.nearestGuards(item, 2);
      for (const g of responders) this.assign(g, { role: 'investigate', x: item.x, y: item.y, label: 'check ' + item.label, source: 'baseline', kind: item.kind, guard: item.guard });
      if (item.kind === 'cameras') { const g = this.nearestGuards(item, 1)[0]; if (g) this.assign(g, { role: 'panel', x: PANEL.x * TILE + 8, y: PANEL.y * TILE + 24, label: 'restore the cameras', source: 'baseline' }); }
    } else if (net.phase === 'calm') this.setPhase('caution');
  }

  baselineLost() {
    const lkp = this.net.lastSeen;
    if (!lkp) return;
    for (const g of this.guards) {
      if (g.down || g.sees || g.objective) continue;
      if (g.task?.role !== 'pursue') continue;
      const angle = this.random() * Math.PI * 2, r = (1 + this.random() * 5) * TILE;
      const target = { x: lkp.x + Math.cos(angle) * r, y: lkp.y + Math.sin(angle) * r };
      this.assign(g, { role: 'search', zone: zoneAt(target.x, target.y), x: target.x, y: target.y, label: 'search near the sighting', source: 'baseline' });
    }
  }

  nearestGuards(point, count, filter = () => true) {
    const field = distanceField(toTile(point.x), toTile(point.y), guardWalk);
    return this.guards.filter(g => !g.down && !g.sees && filter(g)).map(g => ({ g, d: field[index(toTile(g.x), toTile(g.y))] }))
      .filter(item => Number.isFinite(item.d)).sort((a, b) => a.d - b.d).slice(0, count).map(item => item.g);
  }

  /* ── the commander ─────────────────────────────────────────────────────── */

  /**
   * One commander decision. The local System-One policy answers at once so the
   * guards never wait; if Jev is connected its answers replace the local ones
   * when they arrive, as long as the situation has not moved on.
   */
  decide(kind, event) {
    const net = this.net;
    if (this.mode === 'baseline') {
      if (kind === 'contact') this.baselineContact();
      return null;
    }
    const situation = buildSituation(this, kind, event);
    const local = localAnswers(kind, situation, this.random);
    const plan = planFromAnswers(kind, local, situation);
    const localPlanSignature = planSignature(plan);
    const sightingAtRequest = net.lastSeen ? { ...net.lastSeen } : null;
    const decision = {
      id: ++this.decisionSerial, kind, t: this.t, situation, answers: local, localAnswers: local, plan, source: 'local',
      status: this.remote ? 'asking jev' : 'local', latency: null, event: event ? { kind: event.kind, label: event.label, zone: event.zone } : null,
    };
    this.decisions.unshift(decision);
    this.decisions.length = Math.min(this.decisions.length, 24);
    net.decision = decision;
    net.lastDecisionAt = this.t;
    this.metrics.decisions++;
    this.applyPlan(plan, decision, situation, event);
    if (this.remote) {
      const asked = performance.now();
      Promise.resolve().then(() => this.remote(kind, situation)).then(answers => {
        decision.latency = performance.now() - asked;
        if (this.status !== 'playing') return;
        const merged = readAnswers(kind, answers, situation, local);
        if (!merged || merged === local) { decision.status = 'jev unreadable · local kept'; this.metrics.jevFailures++; return; }
        const latest = net.lastSeen;
        const evidenceMoved = latest && (!sightingAtRequest || latest.at > sightingAtRequest.at
          && (dist(latest, sightingAtRequest) > TILE || latest.zone !== sightingAtRequest.zone
            || latest.pace !== sightingAtRequest.pace || Math.abs(wrapAngle((latest.heading || 0) - (sightingAtRequest.heading || 0))) > Math.PI / 4));
        if (net.decision !== decision || this.t - decision.t > 8 || evidenceMoved) { decision.status = 'jev late · superseded by newer evidence'; return; }
        const jevPlan = planFromAnswers(kind, merged, situation);
        decision.answers = merged; decision.plan = jevPlan; decision.source = 'jev'; decision.status = 'jev';
        this.metrics.jevDecisions++;
        const same = planSignature(jevPlan) === localPlanSignature;
        if (!same) this.applyPlan(jevPlan, decision, situation, event, true);
        else { net.plan = jevPlan; net.planSource = 'jev'; net.planStatus = 'confirmed by jev'; }
      }).catch(error => {
        decision.latency = performance.now() - asked;
        if (error?.message === 'busy' || error?.message === 'off') { decision.status = error.message === 'busy' ? 'local · jev busy' : 'local'; decision.latency = null; return; }
        decision.status = 'jev unavailable · local kept';
        decision.error = String(error?.message || error).slice(0, 80);
        this.metrics.jevFailures++;
      });
    }
    return decision;
  }

  applyPlan(plan, decision, situation, event, revised = false) {
    const net = this.net;
    net.plan = plan;
    net.planSource = decision.source;
    net.planStatus = revised ? 'revised by jev' : 'issued';
    if (plan.level != null) net.level = decision.kind === 'anomaly' ? Math.max(net.level, plan.level) : Math.max(0, Math.min(3, plan.level));
    if (decision.kind === 'anomaly' && ['body', 'missing'].includes(event?.kind)) net.postureDue = this.t + 5;
    if (plan.prediction) net.prediction = { ...plan.prediction, at: this.t, exitTo: plan.prediction.zone, resolved: null, cleared: 0 };
    net.decisionZone = net.lastSeen?.zone || null;
    if (decision.kind === 'lost' || decision.kind === 'sweep') net.nextSweep = this.t + this.rules.replan;
    if (plan.strategy === 'posture') { this.applyPosture(plan, event); }
    if (plan.strategy === 'stand_down') {
      net.searchUntil = Math.min(net.searchUntil, this.t + 1);
      return;
    }
    if (decision.kind === 'anomaly' && plan.threat != null) {
      if (plan.threat >= 2 && net.phase === 'calm') this.setPhase('caution');
      if (event?.kind === 'cameras' && plan.strategy === 'investigate') {
        const g = this.nearestGuards({ x: PANEL.x * TILE + 8, y: PANEL.y * TILE + 24 }, 1, g => !g.objective)[0];
        if (g) this.order(g, { role: 'panel', x: PANEL.x * TILE + 8, y: PANEL.y * TILE + 24, label: 'restore the cameras' }, decision);
        return;
      }
    }
    if (decision.kind === 'anomaly' && plan.strategy === 'investigate' && event) {
      for (const role of plan.roles) if (role.role === 'investigate') Object.assign(role, { kind: event.kind, guard: event.guard, evidence: event });
    }
    const roles = plan.roles.filter(role => role.role !== 'post');
    if (!roles.length) {
      // A note-only decision: whoever heard it stops waiting and goes back to work.
      if (decision.kind === 'anomaly') for (const g of this.guards) if (g.state === 'suspicious' && g.waitOrders > 0) { g.waitOrders = 0; g.cue = null; g.state = 'patrol'; g.task = null; g.indicator = ''; }
      return;
    }
    this.allocate(roles, plan, decision);
  }

  /** Game-side assignment: each role goes to the closest free guard by path distance. */
  allocate(roles, plan, decision) {
    const net = this.net;
    const taken = new Set();
    const free = g => !g.sees && !g.grabbed && !net.missing.has(g.id) && !(g.task?.role === 'revive') && !(g.down && net.found.has(g.id));
    const objectiveFree = plan.keepObjective === false || this.net.breach;
    const issued = [];
    for (const role of roles) {
      const field = distanceField(toTile(role.x), toTile(role.y), guardWalk);
      let best = null, bestScore = Infinity;
      for (const g of this.guards) {
        if (taken.has(g.id) || !free(g)) continue;
        if (g.objective && !objectiveFree && !OBJECTIVE_ROLES.has(role.role)) continue;
        // Security does not know who is unconscious: a downed guard can be picked.
        const known = g.down ? g.known : g;
        let score = field[index(toTile(known.x), toTile(known.y))];
        if (!Number.isFinite(score)) continue;
        if (role.role === 'pursue' && g.task?.role === 'pursue') score -= 6;
        if (role.role === 'guard' && g.objective) score -= 30;
        if (g.task?.decision === decision.id - 1 && g.task?.role === role.role && Math.hypot(g.task.x - role.x, g.task.y - role.y) < 3 * TILE) score -= 4;
        if (score < bestScore) { bestScore = score; best = g; }
      }
      if (!best) continue;
      taken.add(best.id);
      this.order(best, role, decision);
      issued.push(`${best.name}: ${role.label || role.role}`);
    }
    if (issued.length) this.say('Command', `${plan.summary}. ${issued.slice(0, 3).join(' · ')}${issued.length > 3 ? ' …' : ''}`, decision.kind === 'contact' ? 'alert' : '');
    // Guards left out of the new plan keep working a recent hunting task (a pursuer
    // becomes a local searcher); stale orders lapse and the guard returns to route.
    if (decision.kind === 'contact' || decision.kind === 'lost' || decision.kind === 'sweep') {
      for (const g of this.guards) {
        if (taken.has(g.id) || g.sees || g.down || !g.task || ['post', 'revive', 'panel', 'return', 'guard'].includes(g.task.role)) continue;
        if (this.t - (g.task.issued || 0) < 25) continue;
        this.goHome(g);
      }
    }
  }

  order(g, role, decision) {
    const task = { ...role, source: decision.source, decision: decision.id, issued: this.t + this.rules.radio };
    g.pendingTask = { ...task, deliverAt: this.t + this.rules.radio };
    g.ackDue = this.t + this.rules.radio + 2.5;
    if (g.down) g.lastOrder = task;
  }

  assign(g, task) {
    g.task = { ...task, issued: this.t };
    delete g.task.deliverAt;
    g.path = []; g.pathGoal = null; g.scan = null; g.cue = null;
    g.lastAction = 'acknowledged: ' + (task.label || task.role);
    g.waitOrders = 0;
    if (task.role === 'pursue') { g.state = 'alert'; g.indicator = '!'; }
    else if (['intercept', 'block', 'guard'].includes(task.role)) { g.state = 'lockdown'; g.indicator = '◆'; }
    else if (task.role === 'search' || task.role === 'probe') { g.state = 'search'; g.indicator = '…'; }
    else if (task.role === 'investigate' || task.role === 'panel') { g.state = 'investigate'; g.indicator = '?'; }
    else if (task.role === 'post') { g.state = 'patrol'; g.indicator = ''; }
    else if (task.role === 'return') { g.state = 'returning'; g.indicator = ''; }
    g.indicatorAt = this.t;
  }

  applyPosture(plan, event) {
    const net = this.net;
    net.posture = plan;
    const reserve = this.guards.filter(g => g.reserve && !g.down && !net.missing.has(g.id));
    const watch = plan.watch ? POST_BY_ID[plan.watch] : null;
    const queue = reserve.slice();
    if (watch && queue.length) {
      const g = queue.shift();
      const post = { role: 'post', x: watch.x * TILE, y: watch.y * TILE, face: watch.face, post: watch.id, label: 'watch ' + watch.name };
      g.route = [{ x: post.x, y: post.y, hold: 9, face: watch.face }];
      g.routeIndex = 0;
      if (this.t < .1) { g.x = post.x; g.y = post.y; g.facing = watch.face; g.task = null; }
      else this.assign(g, { role: 'return', label: 'move to ' + watch.name });
      g.patrolKey = 'post:' + watch.id;
    }
    const focus = plan.focus ? SECTOR_PATROL[plan.focus] : null;
    const stagger = plan.pattern === 'staggered' ? () => .5 + this.random() * 1.4 : null;
    for (const g of queue) {
      if (!focus) break;
      const [key, variant] = focus;
      const core = this.guards.find(other => !other.reserve && other.home === key);
      g.route = this.routeFor(key, plan.pattern === 'paired' && core ? core.variant : variant, { reverse: plan.pattern === 'paired', stagger });
      g.routeIndex = plan.pattern === 'paired' ? Math.floor(g.route.length / 2) : 0;
      g.patrolKey = key;
      if (this.t < .1) { const start = g.route[g.routeIndex]; g.x = start.x; g.y = start.y; }
      else this.assign(g, { role: 'return', label: 'reinforce ' + plan.focus });
    }
    for (const g of this.guards) {
      if (g.reserve) continue;
      if (plan.pattern === 'tight' && (g.home === 'lab' || g.home === 'helipad' || g.home === 'server')) { g.route = this.routeFor(g.home, 1); g.routeIndex = 0; }
      else if (plan.pattern === 'staggered' && stagger) g.route = this.routeFor(g.home, g.variant, { stagger });
    }
    if (event?.kind === 'stand_down' && net.breach) {
      const post = POST_BY_ID.heli_west;
      const g = this.nearestGuards({ x: post.x * TILE, y: post.y * TILE }, 1, other => !other.objective)[0];
      if (g) this.order(g, { role: 'guard', x: post.x * TILE, y: post.y * TILE, face: post.face, label: 'hold the helipad' }, net.decision);
    }
    if (this.t < .1) {
      for (const g of this.guards) { const first = g.route[g.routeIndex] || g.route[0]; if (!g.reserve && first) { g.x = first.x; g.y = first.y; } }
    }
  }

  baselineContact() {
    const lkp = this.net.lastSeen;
    if (!lkp) return;
    this.net.level = 3;
    for (const g of this.nearestGuards(lkp, 4, g => !g.objective)) this.assign(g, { role: 'pursue', x: lkp.x, y: lkp.y, label: 'converge on the sighting', source: 'baseline' });
  }

  /** The interaction the player can perform right now, for the on-screen prompt. */
  prompt() {
    const p = this.player;
    if (this.status !== 'playing') return '';
    if (p.locker) return 'E - leave the locker';
    if (p.action) {
      if (p.action.kind === 'takedown') return 'taking down...';
      if (p.action.kind === 'kill') return 'knife...';
      const left = Math.max(0, p.action.need - p.action.t).toFixed(1);
      return p.action.kind === 'hack' ? `hold E - downloading ${left}s` : `hold E - cutting the feeds ${left}s`;
    }
    if (p.carrying) {
      const locker = this.lockerNear(p, 22);
      return locker && !locker.body && !locker.player ? 'E - stow the body in the locker' : 'E - drop the body';
    }
    const target = this.takedownTarget();
    const downed = this.guards.find(g => g.down && !g.dead && !g.hidden && !g.carried && dist(g, p) < 18);
    if (target) return `E - take down ${target.name} · click - knife`;
    if (downed) return `E - drag ${downed.name}${downed.keycard ? ' · has a keycard' : ''} · click - finish`;
    const dead = this.guards.find(g => g.dead && !g.hidden && !g.carried && dist(g, p) < 18);
    if (dead) return `E - drag ${dead.name}${dead.keycard ? ' · has a keycard' : ''}`;
    if (!p.data && dist(p, { x: TERMINAL.x * TILE, y: TERMINAL.y * TILE + 10 }) < 26) return 'hold E - download the data';
    if (!this.net.camerasOff && dist(p, { x: PANEL.x * TILE + 8, y: PANEL.y * TILE + 8 }) < 24) return 'hold E - disable the cameras';
    if (this.keycardOnDesk && dist(p, { x: KEYCARD.x * TILE, y: KEYCARD.y * TILE }) < 22) return 'E - take the lab keycard';
    const locker = this.lockerNear(p, 20);
    if (locker && !locker.body && !locker.player) return 'E - hide in the locker';
    const door = [...this.doors.values()].find(d => d.locked && !p.keycard && Math.hypot(d.tx * TILE + 8 - p.x, d.ty * TILE + 8 - p.y) < 24);
    if (door) return 'locked - needs a lab keycard';
    return '';
  }

  /* ── capture and mission ───────────────────────────────────────────────── */

  updateCapture(dt) {
    const p = this.player;
    let close = false;
    for (const g of this.guards) {
      if (g.down || !g.sees || g.freeze > 0) continue;
      if (dist(g, p) <= this.rules.capture && lineClear(g.x, g.y, p.x, p.y, this.doorOpen, false)) { close = true; break; }
    }
    p.caught = close ? p.caught + dt : Math.max(0, p.caught - dt * 2);
    if (p.caught >= this.rules.captureTime && !this.noCapture) this.finish('captured');
  }

  updateMission() {
    const p = this.player;
    if (!p.data) return;
    const [x0, y0, x1, y1] = EXTRACTION.rect;
    const tx = toTile(p.x), ty = toTile(p.y);
    if (tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1) this.finish('extracted');
  }

  finish(status) {
    if (this.status !== 'playing') return;
    this.status = status;
    if (this.net.lostEpisode && status === 'extracted') this.metrics.recoveries++;
    this.emit('finish', { status });
  }

  /** What security can establish after the mission, for the dossier. Forensic traces, not live knowledge. */
  report() {
    const m = this.metrics;
    const known = this.guards.filter(g => g.down && this.net.found.has(g.id));
    const knownKills = known.filter(g => g.dead).length;
    return {
      outcome: this.status, difficulty: this.rules.id, time: Math.round(this.t), entry: this.mission.entry, labEntry: this.mission.labEntry,
      data: this.player.data, alerts: m.alerts, sightings: m.sightings, takedowns: this.guards.filter(g => g.down && !g.dead || this.net.found.has(g.id) && !g.dead).length,
      takedownsKnown: this.net.found.size + this.net.missing.size - knownKills, kills: m.kills, killsKnown: knownKills, shots: m.shots,
      distractions: m.distractions, escapes: m.escapes.slice(), vanish: m.vanish.slice(),
      foundIn: m.foundIn.slice(), afterDetect: m.afterDetect.slice(), running: m.movingTime ? m.runningTime / m.movingTime : 0,
      predictionsHit: m.predictionsHit, predictionsMiss: m.predictionsMiss, interceptions: m.interceptions, searches: m.searches,
      reacquired: m.reacquired, recoveries: m.recoveries, cameras: this.mission.panelAt != null,
    };
  }

  /** Mission score for the debrief. */
  score() {
    const m = this.metrics, extracted = this.status === 'extracted';
    const takedowns = m.takedowns, kills = m.kills;
    let points = extracted ? 2000 : this.player.data ? 600 : 0;
    points -= m.alerts * 250 + Math.max(0, m.sightings - m.alerts) * 15 + takedowns * 40;
    points += m.killPoints;
    if (extracted) points += Math.max(0, 900 - this.t) * 2;
    if (extracted && !m.alerts) points += 800;
    if (extracted && !m.alerts && !takedowns && !kills) points += 400;
    points = Math.max(0, Math.round(points));
    const rank = !extracted ? (this.player.data ? 'Courier' : 'Captured')
      : !m.alerts && !takedowns && !kills ? 'Phantom'
        : !m.alerts && !kills ? 'Ghost'
          : !m.alerts ? 'Cleaner'
            : kills >= 4 ? 'Butcher'
              : m.alerts <= 1 ? 'Shade' : m.alerts <= 3 ? 'Jackal' : 'Hound';
    return { points, rank };
  }
}
