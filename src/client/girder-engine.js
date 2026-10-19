// Girder Run's pure level generator. No DOM: layouts can be checked from node.
export const TILE = 16;
export const COLS = 20;
export const ROWS = 15;
export const W = COLS * TILE;
export const H = ROWS * TILE;
export const FLOOR_COUNT = 8;
export const START_HEARTS = 4;
export const PLATFORM_ROWS = Object.freeze([2, 5, 8, 11, 14]);

const FLOOR_NAMES = ['the first climb', 'the rivet hall', 'the fire stair', 'the broken span', 'the high works', 'the black ladder', 'the last girder', 'the keeper’s roof'];

export const RELICS = Object.freeze([
  { id: 'spring-boots', name: 'Spring boots', desc: 'Jump 18% higher.' },
  { id: 'iron-heart', name: 'Iron heart', desc: '+1 max heart and heal 1.' },
  { id: 'double-jump', name: 'Winged boots', desc: 'Jump once more in midair.' },
  { id: 'gloves', name: 'Climbing gloves', desc: 'Climb 35% faster.' },
  { id: 'lucky-pockets', name: 'Lucky pockets', desc: 'Coins are worth 1 more.' },
  { id: 'slow-barrels', name: 'Bent axle', desc: 'Barrels roll 20% slower.' },
  { id: 'quick-feet', name: 'Quick feet', desc: 'Run 15% faster.' },
  { id: 'hard-hat', name: 'Hard hat', desc: 'The first hit each floor is free.' },
  { id: 'second-wind', name: 'Second wind', desc: 'Survive one fatal blow per run at 1 heart.' },
  { id: 'magnet', name: 'Coin magnet', desc: 'Nearby coins drift toward you.' },
  { id: 'gambler', name: 'Gambler’s pocket', desc: 'A coin has a 25% chance to pay 2 extra.' },
  { id: 'feather', name: 'Feather fall', desc: 'The first big fall each floor is free.' },
  { id: 'greedy', name: 'Cursed ledger', desc: 'Coins pay 1 extra, but barrels roll 12% faster.', tone: 'cursed' },
]);

export const OMENS = Object.freeze([
  { id: 'barrel-rain', name: 'Barrel rain', desc: 'The keeper throws faster.', tone: 'bad' },
  { id: 'loose-girders', name: 'Loose girders', desc: 'An extra gap in the steel.', tone: 'bad' },
  { id: 'fire-drill', name: 'Fire drill', desc: 'One extra fireball patrols.', tone: 'bad' },
  { id: 'quick-fuse', name: 'Quick fuse', desc: 'Barrels roll faster.', tone: 'bad' },
  { id: 'rich-seam', name: 'Rich seam', desc: 'Extra coins on this floor.', tone: 'good' },
  { id: 'sure-footed', name: 'Sure footing', desc: 'The first big fall is free.', tone: 'good' },
]);

// The keeper's throwing style is rolled from the run seed, one style per floor.
export const THROW_STYLES = Object.freeze([
  { id: 'steady', name: 'steady throws', desc: 'One barrel at a time.' },
  { id: 'double', name: 'double throws', desc: 'Two barrels, then a longer pause.' },
  { id: 'wild', name: 'wild barrels', desc: 'Some barrels drop down the ladders.' },
  { id: 'ladder', name: 'ladder drops', desc: 'Barrels fall straight down the shafts.' },
  { id: 'cross', name: 'crossfire', desc: 'The keeper throws from alternating hands.' },
]);

// What each relic actually lets the player do. Jev reads this table, not just the names.
export const RELIC_CAPS = Object.freeze({
  'spring-boots': { jump: 1.18, tags: ['mobility'] },
  'iron-heart': { health: 1, tags: ['health'] },
  'double-jump': { airJumps: 1, tags: ['mobility'] },
  gloves: { climb: 1.35, tags: ['mobility'] },
  'lucky-pockets': { coinFocus: 1, coinValue: 1, tags: ['economy'] },
  'slow-barrels': { defense: 1, tags: ['defense'] },
  'quick-feet': { run: 1.15, tags: ['mobility'] },
  'hard-hat': { freeHit: 1, defense: 1, tags: ['defense'] },
  'second-wind': { secondWind: 1, tags: ['health'] },
  magnet: { coinFocus: 2, tags: ['economy'] },
  gambler: { coinFocus: 1, tags: ['economy'] },
  feather: { freeFall: 1, defense: 1, tags: ['defense'] },
  greedy: { risk: 1, coinFocus: 1, coinValue: 1, tags: ['risk'] },
});

/** Turns the live run into the capabilities Jev can reason about. */
export function readLoadout(run, floor) {
  const caps = {
    run: 1, jump: 1, climb: 1, airJumps: 0, health: 0, freeHit: 0,
    freeHitUsed: Boolean(floor?.hardHatUsed), freeFall: 0,
    freeFallUsed: Boolean(floor?.featherUsed || floor?.softFallUsed),
    secondWind: 0, secondWindUsed: Boolean(run.secondWindUsed),
    coinFocus: 0, coinValue: 0, defense: 0, risk: 0, tags: [],
  };
  for (const id of run.relics || []) {
    const cap = RELIC_CAPS[id];
    if (!cap) continue;
    for (const [key, value] of Object.entries(cap)) {
      if (key === 'tags') caps.tags.push(...value);
      else if (key === 'run' || key === 'jump' || key === 'climb') caps[key] *= value;
      else caps[key] += value;
    }
  }
  return caps;
}

const nearestLadderColumn = (plan, x) => {
  const top = PLATFORM_ROWS[0];
  const options = plan.ladders.filter(ladder => ladder.topRow === top);
  if (!options.length) return 10;
  return options.reduce((best, ladder) => {
    const distance = Math.abs(ladder.col * TILE + TILE / 2 - x);
    return !best || distance < best.distance ? { col: ladder.col, distance } : best;
  }, null).col;
};

/**
 * Jev, the keeper's System-One throw model. It sees the player's live route,
 * hearts, hammer and every relic capability above, then chooses a hand, a
 * barrel type, a ladder shaft and the next pause. It is deliberately readable:
 * every decision comes back with a short intent the UI can show.
 */
export function jevDecide({ run, floor, player, loadout, barrelCount = 0, hammerTimer = 0, random = Math.random }) {
  const style = floor.throws?.id || 'steady';
  const center = player.x + (player.w || 10) / 2;
  const side = center < W / 2 ? -1 : 1;
  const lead = player.vx > 12 ? 1 : player.vx < -12 ? -1 : side;
  const progress = Math.max(0, Math.min(1, 1 - player.y / (H - 16)));
  const low = run.hearts <= 1 && !(loadout.secondWind && !loadout.secondWindUsed) && !(loadout.freeHit && !loadout.freeHitUsed);
  const protectedPlayer = (loadout.freeHit && !loadout.freeHitUsed)
    || (loadout.secondWind && !loadout.secondWindUsed)
    || (loadout.freeFall && !loadout.freeFallUsed);
  let hand = lead || side;
  let kind = 'normal';
  let dropCol = null;
  let double = false;
  let intent = 'steady throw';

  if (style === 'cross') { hand = random() < .5 ? -1 : 1; intent = 'crossfire'; }
  if (style === 'wild') { kind = random() < .3 + progress * .24 ? 'wild' : 'normal'; intent = kind === 'wild' ? 'wild barrel' : 'steady throw'; }
  if (style === 'ladder') { kind = 'ladder'; intent = 'ladder drop'; }
  if (style === 'double') { double = true; intent = 'double throw'; }

  if (player.climbing) {
    kind = 'ladder';
    dropCol = player.climbCol ?? nearestLadderColumn(floor, center);
    intent = 'hit the ladder';
  }
  if (hammerTimer > 0) {
    kind = 'ladder';
    hand = -side;
    double = false;
    intent = 'stay away from the hammer';
  } else if (loadout.airJumps > 0 || loadout.jump > 1.05) {
    double = double || random() < .4;
    if (!player.climbing) intent = double ? 'test the air control' : 'test the jump';
  }
  if (protectedPlayer && hammerTimer <= 0) {
    double = double || random() < .55;
    intent = 'burn the safety net';
  }
  if (low) {
    double = false;
    if (style !== 'ladder') kind = 'normal';
    intent = 'ease off';
  }
  if (loadout.coinFocus > 0 && hammerTimer <= 0 && kind === 'normal' && !player.climbing) {
    const left = floor.coins.filter(coin => !coin.taken && coin.x < W / 2).length;
    const right = floor.coins.filter(coin => !coin.taken && coin.x >= W / 2).length;
    if (left !== right) hand = right > left ? 1 : -1;
    intent = 'guard the coins';
  }
  if (progress > .64 && kind === 'normal' && random() < .46) {
    kind = 'ladder';
    dropCol = nearestLadderColumn(floor, center);
    intent = 'cut off the top';
  }
  if (kind === 'ladder' && dropCol == null) dropCol = nearestLadderColumn(floor, center);
  if (double && kind === 'ladder') dropCol = nearestLadderColumn(floor, center);

  let delay = floor.barrel.interval * (.88 + random() * .24);
  if (low) delay *= 1.3;
  if (double) delay *= 1.1;
  if (protectedPlayer) delay *= .96;
  if (loadout.defense > 0) delay *= .92;
  if (loadout.risk > 0) delay *= .94;
  if (barrelCount >= 5) delay *= 1.12;
  return { hand: hand || 1, kind, dropCol, double, delay, intent };
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

const pick = (list, random) => list[Math.floor(random() * list.length)];
const shuffle = (list, random) => {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
};

/** Splits one platform row into pixel spans, leaving the generated gaps open. */
export function segmentsFor(row, gaps) {
  const holes = new Set(gaps[row] || []);
  const spans = [];
  let start = 0;
  for (let col = 0; col < COLS; col++) {
    if (!holes.has(col)) continue;
    if (col > start) spans.push({ from: start * TILE, to: col * TILE });
    start = col + 1;
  }
  if (start < COLS) spans.push({ from: start * TILE, to: W });
  return spans;
}

export function onSegments(segments, x) {
  return segments.some(span => x >= span.from && x <= span.to);
}

export function createFloorPlan(depth, seed) {
  if (depth < 0 || depth >= FLOOR_COUNT) throw new Error('No such floor.');
  const random = mulberry32((seed ^ Math.imul(depth + 1, 0x9e3779b1)) >>> 0);
  const boss = depth === FLOOR_COUNT - 1;
  const omen = !boss && depth > 0 && random() < 0.72 ? pick(OMENS, random) : null;
  const throwPool = depth === 0 ? [THROW_STYLES[0]] : boss ? [THROW_STYLES[1], THROW_STYLES[2], THROW_STYLES[3], THROW_STYLES[4]] : THROW_STYLES;
  const throws = pick(throwPool, random);
  const gaps = {};
  const gapRows = [5, 8, 11];
  let gapCount = depth < 1 ? 0 : Math.min(6, 1 + Math.floor(depth / 3));
  if (omen?.id === 'loose-girders') gapCount = Math.min(7, gapCount + 2);
  for (let i = 0; i < gapCount; i++) {
    const row = gapRows[i % gapRows.length];
    const used = new Set(gaps[row] || []);
    const options = [];
    for (let col = 2; col < COLS - 2; col++) if (!used.has(col)) options.push(col);
    if (!options.length) continue;
    const col = pick(options, random);
    used.add(col);
    gaps[row] = [...used];
  }

  const solid = (row, col) => !(gaps[row] || []).includes(col);
  const ladders = [];
  let previousLadderCol = -1;
  for (let i = 0; i < PLATFORM_ROWS.length - 1; i++) {
    const topRow = PLATFORM_ROWS[i], bottomRow = PLATFORM_ROWS[i + 1];
    const columns = [];
    for (let col = 2; col < COLS - 2; col++) if (solid(topRow, col) && solid(bottomRow, col)) columns.push(col);
    if (!columns.length) continue;
    const count = depth >= 3 && random() < 0.55 ? 2 : 1;
    const chosen = shuffle(columns.slice(), random);
    const useful = [];
    for (const col of chosen) {
      if (useful.length >= count) break;
      if (col === previousLadderCol && useful.length + 1 < count) continue;
      useful.push(col);
    }
    if (!useful.length) useful.push(chosen[0]);
    for (const col of useful) ladders.push({ col, topRow, bottomRow });
    previousLadderCol = useful[useful.length - 1];
  }

  const topRow = PLATFORM_ROWS[0];
  const topLadderCols = new Set(ladders.filter(ladder => ladder.topRow === topRow).map(ladder => ladder.col));
  const exitOptions = [];
  for (let col = 2; col < COLS - 2; col++) if (solid(topRow, col) && !topLadderCols.has(col) && col !== Math.floor(COLS / 2)) exitOptions.push(col);
  const exitCol = pick(exitOptions.length ? exitOptions : [10], random);

  const ladderCols = new Set(ladders.map(ladder => ladder.col));
  const occupied = new Set();
  const coinCount = Math.min(12, 5 + depth + (omen?.id === 'rich-seam' ? 3 : 0));
  const coins = [];
  const coinRows = [2, 5, 8, 11, 14];
  let guard = 0;
  while (coins.length < coinCount && guard++ < 400) {
    const row = pick(coinRows, random);
    const col = 2 + Math.floor(random() * (COLS - 4));
    if (!solid(row, col)) continue;
    if (ladderCols.has(col) || col === exitCol) continue;
    const slot = row + ':' + col;
    if (occupied.has(slot)) continue;
    occupied.add(slot);
    coins.push({ row, col, x: col * TILE + TILE / 2, y: row * TILE - 10, taken: false });
  }

  let hammer = null;
  if (depth >= 2 && random() < 0.62) {
    for (let attempt = 0; attempt < 80 && !hammer; attempt++) {
      const row = pick([5, 8, 11], random);
      const col = 2 + Math.floor(random() * (COLS - 4));
      const slot = row + ':' + col;
      if (!solid(row, col) || ladderCols.has(col) || occupied.has(slot)) continue;
      occupied.add(slot);
      hammer = { row, col, x: col * TILE + TILE / 2, y: row * TILE - 12, taken: false };
    }
  }

  const fireballs = [];
  const fireCount = (depth >= 2 ? 1 : 0) + (depth >= 5 ? 1 : 0) + (omen?.id === 'fire-drill' ? 1 : 0) + (boss ? 1 : 0);
  for (let i = 0; i < fireCount; i++) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const row = pick([5, 8, 11], random);
      const spans = segmentsFor(row, gaps).filter(span => span.to - span.from >= TILE * 2);
      if (!spans.length) continue;
      const span = pick(spans, random);
      const x = span.from + TILE + random() * Math.max(1, span.to - span.from - TILE * 2);
      fireballs.push({ row, x, dir: random() < 0.5 ? -1 : 1 });
      break;
    }
  }

  const interval = Math.max(1.1, 2.9 - depth * 0.18) * (omen?.id === 'barrel-rain' ? 0.76 : 1) * (boss ? 0.86 : 1)
    * (throws.id === 'double' ? 1.16 : throws.id === 'ladder' ? 1.1 : 1);
  const speed = (34 + depth * 4) * (omen?.id === 'quick-fuse' ? 1.12 : 1);
  return {
    v: 1,
    depth,
    seed,
    name: FLOOR_NAMES[depth],
    boss,
    platforms: PLATFORM_ROWS.map(row => ({ row, segments: segmentsFor(row, gaps) })),
    gaps,
    ladders,
    exit: { row: topRow, col: exitCol, x: exitCol * TILE + TILE / 2, y: topRow * TILE - 24 },
    keeper: { x: W / 2 },
    coins,
    hammer,
    fireballs,
    omen: omen ? { id: omen.id, name: omen.name, desc: omen.desc, tone: omen.tone } : null,
    throws: { id: throws.id, name: throws.name, desc: throws.desc },
    barrel: { interval, speed },
    softFall: omen?.id === 'sure-footed',
    softFallUsed: false,
  };
}

/** True when every platform's solid columns plus ladders can reach the top. Used by checks. */
export function planIsReachable(plan) {
  const rows = plan.platforms.map(platform => platform.row);
  let reachable = new Set([rows.length - 1]);
  for (let i = rows.length - 2; i >= 0; i--) {
    if (!plan.ladders.some(ladder => ladder.topRow === rows[i] && ladder.bottomRow === rows[i + 1])) continue;
    reachable.add(i);
  }
  return reachable.size === rows.length;
}
