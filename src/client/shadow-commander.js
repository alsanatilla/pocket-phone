// Shadow Protocol's commander: what security knows (the situation Jev reads),
// the map-checked plans Jev chooses between, its belief about the intruder,
// a deterministic fixture for mocks and tests, and the persistent dossier.
// Live missions only accept Jev's complete orders.
import {
  TILE, ZONES, ZONE_BY_ID, PORTALS, POSTS, POST_BY_ID, HIDING, HIDING_CLUSTERS, SECTORS, TERMINAL, EXTRACTION,
  toTile, zoneAt, zoneOfTile,
} from './shadow-level.js';
import { distanceField, guardWalk, playerWalk, nearestPassable, index, angleTo, wrapAngle, mulberry32 } from './shadow-nav.js';
import { SHADOW_GAME, INTENTS, INTENT_NAMES, shadowQuestions, planFromAnswers } from '../shared/shadow-jev.js';
import { ENTRY_NAMES, LAB_NAMES } from './shadow-voice.js';

const round = value => Math.round(value * 10) / 10;
const whole = value => Math.round(value);
const crawlWalk = (tx, ty) => playerWalk(tx, ty, true);
const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
const compass = angle => Number.isFinite(angle) ? COMPASS[((Math.round(angle / (Math.PI / 4)) % 8) + 8) % 8] : 'unknown';

const ZONE_TILES = Object.fromEntries(ZONES.map(zone => {
  const tiles = [];
  for (const rect of zone.rects || [zone.rect]) for (let ty = rect[1]; ty <= rect[3]; ty++) for (let tx = rect[0]; tx <= rect[2]; tx++) if (zoneOfTile(tx, ty) === zone.id && crawlWalk(tx, ty)) tiles.push([tx, ty]);
  return [zone.id, tiles];
}));

// Zone-graph hops to the objective and to the extraction pad.
function hopsFrom(target) {
  const hops = { [target]: 0 }, queue = [target];
  while (queue.length) {
    const zone = queue.shift();
    for (const portal of PORTALS) {
      const other = portal.a === zone ? portal.b : portal.b === zone ? portal.a : null;
      if (other && hops[other] == null) { hops[other] = hops[zone] + 1; queue.push(other); }
    }
  }
  return hops;
}
const TO_SERVER = hopsFrom('server');
const TO_HELIPAD = hopsFrom('helipad');

const ENTRY_POSTS = { culvert: ['culvert_mouth'], gate: ['gate', 'corr_south_door'], fence: ['east_fence', 'barracks_south_door'] };
const LAB_POSTS = { duct: ['duct_exit', 'duct_grate'], keycard: ['lab_main_door', 'alley_mid'], north: ['lab_north_door', 'lane_west'], east: ['lab_east_door', 'heli_west'] };
const ENTRY_SECTOR = { culvert: 'warehouse', gate: 'corridors', fence: 'barracks' };
const LAB_SECTOR = { duct: 'warehouse', keycard: 'corridors', north: 'north', east: 'north' };

/* ── dossier ───────────────────────────────────────────────────────────────── */

export function emptyDossier() {
  return {
    v: 1, attempts: 0, captures: 0, extractions: 0, entries: {}, labEntries: {}, escapes: {}, vanish: {}, found: {},
    afterDetect: { hid: 0, fled: 0 }, distractions: 0, takedowns: 0, kills: 0, alerts: 0, running: 0, predictions: { hit: 0, miss: 0 }, history: [],
  };
}

export function readDossier(value) {
  const base = emptyDossier();
  if (!value || typeof value !== 'object' || value.v !== 1) return base;
  const map = item => Object.fromEntries(Object.entries(item && typeof item === 'object' ? item : {}).filter(([, n]) => Number.isFinite(n) && n > .01).slice(0, 40));
  return {
    ...base,
    attempts: Number(value.attempts) || 0, captures: Number(value.captures) || 0, extractions: Number(value.extractions) || 0,
    entries: map(value.entries), labEntries: map(value.labEntries), escapes: map(value.escapes), vanish: map(value.vanish), found: map(value.found),
    afterDetect: { hid: Number(value.afterDetect?.hid) || 0, fled: Number(value.afterDetect?.fled) || 0 },
    distractions: Number(value.distractions) || 0, takedowns: Number(value.takedowns) || 0, kills: Number(value.kills) || 0, alerts: Number(value.alerts) || 0, running: Number(value.running) || 0,
    predictions: { hit: Number(value.predictions?.hit) || 0, miss: Number(value.predictions?.miss) || 0 },
    history: Array.isArray(value.history) ? value.history.slice(0, 8) : [],
  };
}

/**
 * Folds one mission's forensic report into the dossier. Older attempts fade,
 * so a player who changes habits is followed rather than chased into the past.
 */
export function recordMission(dossier, report) {
  const d = readDossier(JSON.parse(JSON.stringify(dossier || emptyDossier())));
  const decay = .72;
  for (const key of ['entries', 'labEntries', 'escapes', 'vanish', 'found']) for (const name of Object.keys(d[key])) d[key][name] = round(d[key][name] * decay * 100) / 100;
  d.afterDetect.hid *= decay; d.afterDetect.fled *= decay;
  d.predictions.hit *= decay; d.predictions.miss *= decay;
  const add = (map, key, amount = 1) => { if (key) map[key] = round(((map[key] || 0) + amount) * 100) / 100; };
  d.attempts++;
  if (report.outcome === 'captured') d.captures++;
  if (report.outcome === 'extracted') d.extractions++;
  add(d.entries, report.entry);
  add(d.labEntries, report.labEntry);
  const counted = list => { const counts = {}; for (const item of list || []) counts[item] = Math.min(2, (counts[item] || 0) + 1); return counts; };
  for (const [zone, n] of Object.entries(counted(report.escapes))) add(d.escapes, zone, n);
  for (const [spot, n] of Object.entries(counted(report.vanish))) add(d.vanish, spot, n);
  for (const [type, n] of Object.entries(counted(report.foundIn))) add(d.found, type, n);
  for (const item of report.afterDetect || []) if (item === 'hid' || item === 'fled') d.afterDetect[item] += 1;
  d.predictions.hit += report.predictionsHit || 0;
  d.predictions.miss += report.predictionsMiss || 0;
  const blend = (old, value) => d.attempts === 1 ? value : round((old * .6 + value * .4) * 100) / 100;
  d.distractions = blend(d.distractions, report.distractions || 0);
  d.takedowns = blend(d.takedowns, report.takedownsKnown || 0);
  d.kills = blend(d.kills, report.killsKnown || 0);
  d.alerts = blend(d.alerts, report.alerts || 0);
  d.running = blend(d.running, report.running || 0);
  d.history.unshift({ at: Date.now(), outcome: report.outcome, entry: report.entry, labEntry: report.labEntry, alerts: report.alerts, time: report.time, difficulty: report.difficulty });
  d.history = d.history.slice(0, 8);
  return d;
}

const share = (map, key) => {
  const total = Object.values(map || {}).reduce((sum, n) => sum + n, 0);
  return total > 0 ? (map[key] || 0) / (total + .6) : 0;
};
const top = (map, n = 2) => Object.entries(map || {}).filter(([, v]) => v >= .3).sort((a, b) => b[1] - a[1]).slice(0, n);
const clusterName = id => {
  const [zone, type] = String(id).split(':');
  return type ? `${type === 'locker' ? 'the lockers' : 'the tall grass'} in the ${ZONE_BY_ID[zone]?.name || zone}` : `the ${ZONE_BY_ID[zone]?.name || zone}`;
};

/** Plain-language lines for the briefing and debrief. Every line comes from dossier numbers. */
export function dossierInsights(dossier) {
  const d = readDossier(dossier), lines = [];
  if (!d.attempts) return lines;
  for (const [id, n] of top(d.entries, 1)) lines.push(`Gets in through ${ENTRY_NAMES[id] || id} (weight ${n.toFixed(1)}).`);
  for (const [id, n] of top(d.labEntries, 1)) lines.push(`Reaches the lab through ${LAB_NAMES[id] || id} (weight ${n.toFixed(1)}).`);
  for (const [id, n] of top(d.vanish, 2)) lines.push(`Contact is often lost near ${clusterName(id)} (${n.toFixed(1)}).`);
  for (const [id, n] of top(d.escapes, 1)) lines.push(`After being seen, resurfaces in the ${ZONE_BY_ID[id]?.name || id} (${n.toFixed(1)}).`);
  for (const [id, n] of top(d.found, 1)) lines.push(`Has been pulled out of a ${id === 'locker' ? 'locker' : id} ${n.toFixed(1)}×.`);
  const after = d.afterDetect.hid + d.afterDetect.fled;
  if (after >= .8) lines.push(d.afterDetect.hid > d.afterDetect.fled ? 'Tends to go to ground close by when spotted.' : 'Tends to run far when spotted.');
  if (d.distractions >= 1.5) lines.push(`Uses distractions (${d.distractions.toFixed(1)} per attempt): noises may be decoys.`);
  if (d.takedowns >= .8) lines.push(`Knocks out guards (${d.takedowns.toFixed(1)} discovered per attempt).`);
  if (d.kills >= .5) lines.push(`Leaves bodies: ${d.kills.toFixed(1)} killed guards found per attempt. Patrols will pair up.`);
  if (d.running >= .35) lines.push('Moves fast and loud.');
  else if (d.attempts >= 2 && d.running < .12) lines.push('Moves slowly and quietly.');
  const p = d.predictions.hit + d.predictions.miss;
  if (p >= 1) lines.push(`Commander predictions on this intruder: ${Math.round(d.predictions.hit / p * 100)}% right.`);
  return lines;
}

/* ── Jev's working theory of the intruder ─────────────────────────────────── */

const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const normalizeIntent = values => {
  const raw = Object.fromEntries(INTENTS.map(id => [id, Math.max(0, Number.isFinite(values?.[id]) ? values[id] : 0)]));
  const total = INTENTS.reduce((sum, id) => sum + raw[id], 0);
  return total > 0 ? Object.fromEntries(INTENTS.map(id => [id, raw[id] / total])) : Object.fromEntries(INTENTS.map(id => [id, 1 / INTENTS.length]));
};

/** The prior security starts each attempt with, shaped by the dossier and the objective. */
export function initialMind(sim) {
  const d = readDossier(sim.dossier), net = sim.net || {};
  const vanish = Object.values(d.vanish || {}).reduce((sum, n) => sum + n, 0);
  const escapes = Object.values(d.escapes || {}).reduce((sum, n) => sum + n, 0);
  const intent = normalizeIntent({
    server: 1 + (d.entries?.culvert || 0) * .5 + (d.entries?.gate || 0) * .4 + (net.breach ? 0 : 1.4),
    helipad: (net.breach ? 3.2 : .3) + (d.extractions || 0) * .4,
    hunt: .7 + (d.kills || 0) * .5 + (d.takedowns || 0) * .25,
    bait: .7 + (d.distractions || 0) * .35,
    hide: .9 + (d.afterDetect?.hid || 0) * .45 + vanish * .2,
    leave: .5 + escapes * .3,
  });
  return { intent, updatedAt: sim.t || 0, source: d.attempts ? 'dossier' : 'standard patrol doctrine', history: [] };
}

/** The compact belief object shown to Jev and the intel overlay. */
export function readMind(sim) {
  const mind = sim.mind || (sim.mind = initialMind(sim));
  const intent = normalizeIntent(mind.intent);
  const [topId, topValue] = Object.entries(intent).sort((a, b) => b[1] - a[1])[0];
  return {
    intent: Object.fromEntries(INTENTS.map(id => [id, round(intent[id])])),
    top: topId, confidence: round(topValue), label: INTENT_NAMES[topId],
    age: whole((sim.t || 0) - (mind.updatedAt || 0)), source: mind.source,
  };
}

/** Blends a validated intent answer into the ledger without letting one reply erase the prior. */
export function updateMind(sim, answer, situation = null, decisionId = null) {
  if (!answer || !INTENTS.includes(answer.choice)) return null;
  const observed = normalizeIntent(Object.fromEntries(INTENTS.map(id => [
    id, Number.isFinite(answer.probabilities?.[id]) ? answer.probabilities[id] : answer.choice === id ? 1 : 0,
  ])));
  const prior = normalizeIntent((sim.mind || initialMind(sim)).intent);
  const confidence = clamp01(answer.confidence ?? .5);
  const weight = Math.min(.86, .3 + confidence * .6 + (situation?.evidence?.length ? .05 : 0));
  const intent = normalizeIntent(Object.fromEntries(INTENTS.map(id => [id, prior[id] * (1 - weight) + observed[id] * weight])));
  sim.mind = {
    intent, updatedAt: sim.t || 0, source: 'jev',
    history: [{ at: sim.t || 0, decisionId, intent: { ...intent } }, ...(sim.mind?.history || [])].slice(0, 8),
  };
  return intent;
}

/* ── situation: what security knows ────────────────────────────────────────── */

function zoneAnchor(zoneId, origin) {
  // The guard-walkable tile in the zone closest to the origin, or the zone's nearest walkable neighbour.
  const tiles = ZONE_TILES[zoneId] || [];
  let best = null, bestD = Infinity;
  for (const [tx, ty] of tiles) {
    if (!guardWalk(tx, ty)) continue;
    const d = origin ? Math.hypot(tx * TILE + 8 - origin.x, ty * TILE + 8 - origin.y) : 0;
    if (d < bestD) { bestD = d; best = [tx, ty]; }
  }
  if (!best && tiles.length) best = nearestPassable(tiles[0][0], tiles[0][1], guardWalk, 5);
  return best ? { x: best[0] * TILE + 8, y: best[1] * TILE + 8 } : null;
}

function exitFor(portal, fromZone, sim, field, guardFields) {
  const to = portal.a === fromZone ? portal.b : portal.a;
  const from = ZONE_BY_ID[fromZone], target = ZONE_BY_ID[to];
  const px = portal.x * TILE, py = portal.y * TILE;
  const toward = zoneAnchor(to, { x: px, y: py });
  const dir = toward ? angleTo(px, py, toward.x, toward.y) : 0;
  // Stand just beyond the doorway, looking back in.
  let stand = { x: px + Math.cos(dir) * 1.6 * TILE, y: py + Math.sin(dir) * 1.6 * TILE };
  if (!guardWalk(toTile(stand.x), toTile(stand.y))) {
    const near = nearestPassable(toTile(stand.x), toTile(stand.y), guardWalk, 4);
    stand = near ? { x: near[0] * TILE + 8, y: near[1] * TILE + 8 } : toward || stand;
  }
  let beyond = { x: px + Math.cos(dir) * 4.5 * TILE, y: py + Math.sin(dir) * 4.5 * TILE };
  if (!guardWalk(toTile(beyond.x), toTile(beyond.y))) beyond = toward && Math.hypot(toward.x - px, toward.y - py) > TILE * 2 ? toward : stand;
  const d = field ? field[index(toTile(px), toTile(py))] : null;
  let guardDist = Infinity, guardName = null;
  for (const [g, gField] of guardFields) {
    const value = gField[index(toTile(beyond.x), toTile(beyond.y))];
    if (value < guardDist) { guardDist = value; guardName = g.name; }
  }
  // An incapacitated sentry still counts as holding a post until security
  // discovers the body or their radio check fails.
  const guarded = sim.guards.find(g => !sim.net.missing.has(g.id) && !sim.net.found.has(g.id) && g.task && ['block', 'intercept', 'guard', 'post'].includes(g.task.role) && Math.hypot(g.task.x - stand.x, g.task.y - stand.y) < 3 * TILE);
  return {
    id: portal.id, name: `${portal.crawl ? 'the crawlway' : 'the way'} into the ${target?.name || to}`, zone: fromZone, to,
    toward: target?.name, x: stand.x, y: stand.y, beyond, face: dir + Math.PI,
    dist: Number.isFinite(d) ? whole(d) : null, guardDist: Number.isFinite(guardDist) ? whole(guardDist) : null, nearestGuard: guardName,
    tendency: round(sim.dossier.escapes?.[to] || 0), guarded: guarded?.name || null,
    note: [`from the ${from?.name || fromZone}`, portal.crawl ? 'guards cannot crawl through' : '', Number.isFinite(guardDist) ? `nearest free guard ${whole(guardDist)} tiles from the far side` : '', to === 'server' ? 'leads to the objective' : to === 'helipad' ? 'leads to the extraction pad' : ''].filter(Boolean).join('; '),
  };
}

/**
 * Everything the commander may know at this moment. Built only from radio
 * reports, evidence, the guards' own positions and the dossier — never from
 * the player's true position.
 */
export function buildSituation(sim, kind, event = null) {
  const net = sim.net, rules = sim.rules, dossier = readDossier(sim.dossier), t = sim.t;
  const lkp = net.lastSeen;
  const origin = kind === 'anomaly' && event ? { x: event.x, y: event.y, zone: event.zone || zoneAt(event.x, event.y) } : lkp ? { x: lkp.x, y: lkp.y, zone: lkp.zone } : null;
  const known = sim.guards.filter(g => !net.missing.has(g.id) && !(g.down && net.found.has(g.id)));
  const freeGuards = known.filter(g => !g.objective);
  const guardFields = freeGuards.filter(g => g.known?.state !== 'alert').slice(0, 12).map(g => [g, distanceField(toTile(g.known?.x ?? g.x), toTile(g.known?.y ?? g.y), guardWalk)]);
  const elapsed = lkp ? t - lkp.at : 0;
  const reach = lkp ? 2 + Math.min(60, elapsed * 3.1) : 0;
  const field = origin ? distanceField(toTile(origin.x), toTile(origin.y), crawlWalk, 'player') : null;
  const zoneDist = zone => {
    if (!field) return null;
    let best = Infinity;
    for (const [tx, ty] of ZONE_TILES[zone] || []) { const v = field[index(tx, ty)]; if (v < best) best = v; }
    return Number.isFinite(best) ? best : null;
  };

  const candidates = { zones: [], exits: [], clusters: [], posts: [], sectors: [], zoneNames: Object.fromEntries(ZONES.map(zone => [zone.id, zone.name])) };
  if (origin && kind !== 'posture') {
    const zones = ZONES.map(zone => ({ zone, d: zoneDist(zone.id) })).filter(item => item.d != null && (item.d <= reach + 8 || item.zone.id === origin.zone));
    zones.sort((a, b) => a.d - b.d);
    for (const { zone, d } of zones.slice(0, 7)) {
      const anchor = zoneAnchor(zone.id, origin);
      if (!anchor) continue;
      const hiding = HIDING.filter(spot => spot.zone === zone.id).length;
      const tendency = (dossier.escapes[zone.id] || 0) + (dossier.vanish[zone.id] || 0) + Object.entries(dossier.vanish).filter(([id]) => id.startsWith(zone.id + ':')).reduce((sum, [, n]) => sum + n, 0);
      candidates.zones.push({
        id: zone.id, name: zone.name, x: anchor.x, y: anchor.y, dist: whole(d), reachable: d <= reach, hide: hiding,
        searched: net.searched[zone.id] != null ? whole(t - net.searched[zone.id]) : null, tendency: round(tendency),
        note: zone.id === 'server' ? 'the objective' : zone.id === 'helipad' ? 'the extraction pad' : zone.id === 'duct' || zone.id === 'culvert' ? 'guards cannot enter; watch its ends' : '',
        toServer: TO_SERVER[zone.id], toHelipad: TO_HELIPAD[zone.id], dir: angleTo(origin.x, origin.y, anchor.x, anchor.y),
      });
    }
    const zoneIds = new Set(candidates.zones.map(zone => zone.id));
    const exitZones = elapsed > 6 && kind !== 'contact' ? [origin.zone, ...candidates.zones.slice(1, 3).map(zone => zone.id)] : [origin.zone];
    const seen = new Set();
    for (const zone of exitZones) {
      for (const portal of PORTALS) {
        if (portal.a !== zone && portal.b !== zone) continue;
        const to = portal.a === zone ? portal.b : portal.a;
        if (zone !== origin.zone && (to === origin.zone || zoneIds.has(to) && exitZones.includes(to))) continue;
        if (seen.has(portal.id)) continue;
        seen.add(portal.id);
        candidates.exits.push(exitFor(portal, zone, sim, field, guardFields));
      }
    }
    candidates.exits.sort((a, b) => (a.dist ?? 99) - (b.dist ?? 99));
    candidates.exits = candidates.exits.slice(0, 7);
    const clusters = HIDING_CLUSTERS.map(cluster => {
      let best = Infinity;
      for (const spot of cluster.spots) {
        for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const v = field[index(spot.x + dx, spot.y + dy)]; if (v < best) best = v; }
      }
      return { cluster, d: best };
    }).filter(item => Number.isFinite(item.d) && item.d <= reach + 6).sort((a, b) => a.d - b.d).slice(0, 5);
    for (const { cluster, d } of clusters) {
      const nearest = cluster.spots.slice().sort((a, b) => Math.hypot(a.x * TILE - origin.x, a.y * TILE - origin.y) - Math.hypot(b.x * TILE - origin.x, b.y * TILE - origin.y))[0];
      candidates.clusters.push({
        id: cluster.id, name: clusterName(cluster.id), type: cluster.type, zone: cluster.zone, x: nearest.x * TILE + 8, y: nearest.y * TILE + 8,
        dist: whole(d), spots: cluster.spots.length, found: round(dossier.found[cluster.type] || 0), tendency: round(dossier.vanish[cluster.id] || 0),
        checked: net.checked[cluster.id] != null ? whole(t - net.checked[cluster.id]) : null,
      });
    }
  }

  // Posts: the dossier's traffic decides which ones are worth naming.
  const traffic = {};
  const bump = (id, n) => { if (POST_BY_ID[id]) traffic[id] = (traffic[id] || 0) + n; };
  for (const [entry, n] of Object.entries(dossier.entries)) for (const id of ENTRY_POSTS[entry] || []) bump(id, n);
  for (const [entry, n] of Object.entries(dossier.labEntries)) for (const id of LAB_POSTS[entry] || []) bump(id, n);
  for (const [zone, n] of [...Object.entries(dossier.escapes), ...Object.entries(dossier.vanish).map(([id, n]) => [id.split(':')[0], n])]) for (const post of POSTS) if (post.zone === zone) bump(post.id, n * .6);
  const nearLkp = post => Boolean(lkp && t - lkp.at < 240 && (post.zone === lkp.zone || PORTALS.some(portal => (portal.a === lkp.zone && portal.b === post.zone) || (portal.b === lkp.zone && portal.a === post.zone))));
  const postList = POSTS.map(post => ({ post, score: (traffic[post.id] || 0) + (['server_door', 'heli_west', 'lab_main_door', 'duct_exit'].includes(post.id) ? .4 : 0) + (nearLkp(post) ? 1.5 : 0) }))
    .sort((a, b) => b.score - a.score);
  const wanted = kind === 'anomaly' ? 5 : 7;
  // Strong historical traffic must not remove the objective/extraction from
  // the action space: even a convincing decoy cannot make those posts vanish.
  const critical = postList.filter(({ post }) => ['server_door', 'heli_west'].includes(post.id));
  const shortlisted = [...postList.filter(item => !critical.includes(item)).slice(0, wanted - critical.length), ...critical];
  for (const { post } of shortlisted) {
    const reason = post.id === 'server_door' ? 'guards the objective' : post.id === 'heli_west' ? 'covers the extraction pad' : post.id === 'duct_exit' ? 'watches where the duct comes out' : '';
    const near = nearLkp(post);
    candidates.posts.push({ id: post.id, name: post.name, x: post.x * TILE, y: post.y * TILE, face: post.face, zone: post.zone, reason: [reason, near ? 'next to where the intruder was last seen this shift' : ''].filter(Boolean).join('; '), tendency: round(traffic[post.id] || 0), near: near || undefined });
  }
  if (kind === 'posture') {
    for (const [id, name] of Object.entries(SECTORS)) {
      if (id === 'perimeter') continue;
      let weight = 0;
      for (const [entry, n] of Object.entries(dossier.entries)) if (ENTRY_SECTOR[entry] === id) weight += n;
      for (const [entry, n] of Object.entries(dossier.labEntries)) if (LAB_SECTOR[entry] === id) weight += n;
      for (const [zone, n] of Object.entries(dossier.escapes)) if (ZONE_BY_ID[zone]?.sector === id) weight += n * .7;
      for (const [spot, n] of Object.entries(dossier.vanish)) if (ZONE_BY_ID[spot.split(':')[0]]?.sector === id) weight += n * .7;
      candidates.sectors.push({ id, name, weight: round(weight), reason: weight > .2 ? `intruder activity weight ${weight.toFixed(1)} over earlier attempts` : 'no recorded intruder activity' });
    }
  }

  const failures = new Set([...net.found, ...net.missing]).size;
  const knownKills = [...net.found].map(id => sim.guards.find(g => g.id === id)).filter(g => g && g.dead);
  const armed = knownKills.length > 0 || net.evidence.some(item => item.kind === 'corpse' || /gunshot/i.test(item.label || ''));
  const evidence = net.evidence.slice(0, 5).map(item => ({ kind: item.kind, zone: item.zone, ago: whole(t - item.at), label: item.label, count: item.count || 1, cleared: item.cleared != null }));
  const objectiveGuard = known.find(g => g.objective);
  const originGuardField = origin ? distanceField(toTile(origin.x), toTile(origin.y), guardWalk) : null;
  const situation = {
    kind, difficulty: rules.id, time: whole(t), phase: net.phase, level: net.level,
    beliefs: readMind(sim),
    rules: { coordination: rules.coordination, influence: rules.influence, search: rules.search },
    intruder: {
      lastSeen: lkp ? { zone: lkp.zone, x: lkp.x, y: lkp.y, tile: [toTile(lkp.x), toTile(lkp.y)], ago: round(elapsed), heading: compass(lkp.heading), headingAngle: lkp.heading, pace: lkp.pace || 'unknown' } : null,
      sightings: net.sightings.slice(0, 4).map(item => ({ zone: item.zone, ago: whole(t - item.at) })),
      reach: lkp ? whole(reach) : null,
      carryingData: net.breach, keycardMissing: net.keycardMissing,
      armed,
    },
    event: event && kind === 'anomaly' ? { kind: event.kind, label: event.label, zone: origin.zone, x: event.x, y: event.y, ago: whole(t - (event.at ?? t)), count: event.count || 1, loud: event.loud ? round(event.loud) : 0, guard: event.guard } : event?.kind === 'stand_down' ? { kind: 'stand_down' } : null,
    evidence,
    force: {
      active: known.length, free: freeGuards.length, failures, killed: knownKills.length,
      missing: [...net.missing].map(id => sim.guards.find(g => g.id === id)?.name).filter(Boolean),
      found: [...net.found].map(id => sim.guards.find(g => g.id === id)?.name).filter(Boolean),
      dead: knownKills.map(g => g.name),
    },
    guards: known.map(g => {
      const at = g.known || g;
      const distance = originGuardField?.[index(toTile(at.x), toTile(at.y))];
      return { id: g.id, name: g.name, zone: at.zone || zoneAt(at.x, at.y), tile: [toTile(at.x), toTile(at.y)], ago: round(t - (at.t ?? t)), state: at.state || g.state, role: g.task?.role || 'patrol', dist: Number.isFinite(distance) ? whole(distance) : null, objective: g.objective || undefined };
    }),
    objective: { breached: net.breach, guardedBy: objectiveGuard?.name || null, camerasOff: Boolean(net.camerasNoticed && net.camerasOff) },
    candidates,
    tendencies: {
      attempts: dossier.attempts, captures: dossier.captures, extractions: dossier.extractions,
      entries: dossier.entries, labEntries: dossier.labEntries, escapes: dossier.escapes, vanish: dossier.vanish, found: dossier.found,
      afterDetect: { hid: round(dossier.afterDetect.hid), fled: round(dossier.afterDetect.fled) },
      distractionsPerAttempt: dossier.distractions, takedownsPerAttempt: dossier.takedowns, killsPerAttempt: dossier.kills, alertsPerAttempt: dossier.alerts,
      runningShare: dossier.running, predictionAccuracy: dossier.predictions.hit + dossier.predictions.miss > 0 ? round(dossier.predictions.hit / (dossier.predictions.hit + dossier.predictions.miss)) : null,
    },
    plan: net.plan ? { strategy: net.plan.strategy, summary: net.plan.summary, age: whole(t - (net.decision?.t ?? t)), status: net.planStatus || 'issued', predicted: net.prediction?.zone ? ZONE_BY_ID[net.prediction.zone]?.name : null } : null,
  };
  const plans = buildPlans(kind, situation, sim);
  situation.plans = plans;
  situation.candidates = {
    ...situation.candidates,
    plans: plans.map(({ id, name, summary, why, risk, counter, roles }) => ({ id, name, summary, why, risk, counter, roles })),
  };
  return situation;
}

/** The state object sent to Jev: names and tiles, no internal world coordinates. */
export function jevState(situation) {
  const strip = value => {
    if (Array.isArray(value)) return value.map(strip);
    if (!value || typeof value !== 'object') return value;
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (['x', 'y', 'face', 'beyond', 'headingAngle', 'dir', 'zoneNames'].includes(key)) continue;
      out[key] = strip(item);
    }
    return out;
  };
  const fields = ['kind', 'difficulty', 'time', 'phase', 'level', 'beliefs', 'rules', 'intruder', 'event', 'evidence', 'force', 'guards', 'objective', 'candidates', 'tendencies', 'plan'];
  const observed = Object.fromEntries(fields.filter(key => Object.hasOwn(situation || {}, key)).map(key => [key, situation[key]]));
  return {
    game: SHADOW_GAME,
    facility: {
      objective: 'server', extraction: 'helipad',
      zones: Object.fromEntries(ZONES.map(zone => [zone.id, zone.name])),
      routes: PORTALS.map(portal => ({ from: portal.a, to: portal.b, guardPassable: !portal.crawl })),
    },
    ...strip(observed),
  };
}

/* ── deterministic answer fixture (development mock and tests only) ────────── */

function choose(scores, random, temperature = .32, noise = .12) {
  const entries = Object.entries(scores).filter(([, v]) => Number.isFinite(v));
  if (!entries.length) return null;
  const max = Math.max(...entries.map(([, v]) => v));
  const exp = entries.map(([k, v]) => [k, Math.exp((v - max) / temperature)]);
  const total = exp.reduce((sum, [, v]) => sum + v, 0);
  const probabilities = Object.fromEntries(exp.map(([k, v]) => [k, Math.round(v / total * 1000) / 1000]));
  let choice = entries[0][0], best = -Infinity;
  for (const [key, value] of entries) { const jitter = value + (random() * 2 - 1) * noise; if (jitter > best) { best = jitter; choice = key; } }
  return { type: 'choice', choice, confidence: probabilities[choice], probabilities };
}
const noul = value => ({ type: 'noul', noul: Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000 });
const score = (value, top = 3) => ({ type: 'score', score: Math.round(Math.max(0, Math.min(top, value)) * 100) / 100, confidence: .6 });

/**
 * Answers every commander question from the same situation Jev would see.
 * This is not a fallback commander: live play only accepts Jev's complete
 * replies. Mocks and tests use this to exercise the same contract offline.
 */
export function atomicAnswers(kind, situation, random = Math.random) {
  const c = situation.candidates, td = situation.tendencies, influence = situation.rules?.influence ?? .5;
  const lkp = situation.intruder.lastSeen, breached = situation.objective.breached;
  const lethal = Number(td.killsPerAttempt) || 0;
  const after = td.afterDetect.hid + td.afterDetect.fled;
  const hidShare = after > 0 ? td.afterDetect.hid / (after + .5) : .35;
  // Physical field orders are answered on every decision, even when the mock
  // chooses to leave the current door, lights and camera sweeps untouched.
  const field = choice => ({ type: 'choice', choice: 'keep', confidence: .6, probabilities: { keep: .6 } });
  const answers = { doors: field(), lights: field(), camera: field() };
  const lkpServer = lkp ? TO_SERVER[lkp.zone] ?? 6 : 6, lkpHeli = lkp ? TO_HELIPAD[lkp.zone] ?? 6 : 6;
  const pull = zone => breached ? (TO_HELIPAD[zone] ?? 6) < lkpHeli ? .45 : 0 : (TO_SERVER[zone] ?? 6) < lkpServer ? .35 : 0;

  if (kind === 'posture') {
    const sectorBase = { lab: .45, warehouse: .3, corridors: .35, barracks: .2, yard: .25, north: .3, exterior: .05 };
    const totalWeight = c.sectors.reduce((sum, item) => sum + item.weight, 0) + .5;
    // Evidence from this shift outranks the dossier: hold the area the intruder vanished from.
    const recent = lkp && lkp.ago < 240 ? ZONE_BY_ID[lkp.zone] : null;
    answers.focus = choose(Object.fromEntries(c.sectors.map(item => [item.id, (sectorBase[item.id] ?? .2) + influence * 1.6 * item.weight / totalWeight + (recent?.sector === item.id ? .7 : 0) + random() * .25])), random, .3, .05);
    const postTotal = c.posts.reduce((sum, item) => sum + item.tendency, 0) + .5;
    answers.watch = choose(Object.fromEntries(c.posts.map(item => [item.id, (item.id === 'server_door' ? .05 : .2) + influence * 1.8 * item.tendency / postTotal + (item.near ? .8 : 0) + random() * .3])), random, .3, .05);
    const failures = situation.force.failures;
    answers.pattern = choose({
      standard: .5 - failures * .2 - lethal * .35,
      paired: .2 + Math.min(1, td.takedownsPerAttempt * .3) * influence + failures * .55 + lethal * .7,
      staggered: .2 + Math.min(.8, td.distractionsPerAttempt * .15) * influence + random() * .15,
      tight: .15 + (td.extractions ? .35 * influence : 0) + (breached ? .5 : 0) + lethal * .2,
    }, random, .25, .08);
    const level = situation.event?.kind === 'stand_down' ? 2.3 : 1 + Math.min(1, td.attempts * .25) * influence + Math.min(.8, failures * .4) + Math.min(.6, lethal * .3);
    answers.level = score(level);
    answers.probe = noul(.2 + Math.min(.5, (td.found.locker || 0) * .25 + Object.entries(td.vanish).filter(([id]) => id.endsWith(':locker')).reduce((sum, [, n]) => sum + n, 0) * .15) * influence * 1.4);
    return answers;
  }

  if (kind === 'contact') {
    const heading = lkp?.headingAngle;
    const scores = {};
    for (const exit of c.exits) {
      const align = Number.isFinite(heading) && lkp ? Math.cos(wrapAngle(angleTo(lkp.x, lkp.y, exit.x, exit.y) - heading)) : 0;
      scores[exit.id] = align * .8 + pull(exit.to) + influence * 1.2 * share(td.escapes, exit.to) - (exit.dist ?? 6) / 14;
    }
    const nearHiding = c.clusters.some(cluster => cluster.dist <= 4);
    scores.hide = .1 + hidShare * influence * 1.2 + (nearHiding ? .25 : 0) + (lkp?.pace === 'crawling' ? .2 : 0);
    answers.heading = choose(scores, random, .3, .15);
    const best = c.exits.find(exit => exit.id === answers.heading.choice);
    const objectiveNear = breached || lkpServer <= 1;
    const free = situation.force.free;
    answers.response = choose({
      swarm: (free <= 2 ? .8 : .25) + (situation.difficulty === 'normal' ? .25 : 0) + lethal * .15,
      pincer: free >= 3 && best ? .55 + answers.heading.confidence * .6 + (situation.difficulty !== 'normal' ? .15 : 0) + lethal * .25 : .05,
      contain: .35 + (c.exits.length <= 3 ? .25 : 0) + (answers.heading.choice === 'hide' ? .4 : 0) + lethal * .3,
      protect: objectiveNear ? .95 : .2,
    }, random, .25, .12);
    const ahead = best && best.guardDist != null && best.dist != null && best.guardDist < best.dist + 6;
    answers.intercept = noul(ahead ? .72 : .28);
    answers.hold_objective = noul(breached ? .25 : .82);
    answers.level = score(2.7);
    return answers;
  }

  if (kind === 'lost' || kind === 'sweep') {
    const heading = lkp?.headingAngle;
    const predicted = situation.plan?.predicted;
    const zoneScores = {};
    const elapsed = lkp?.ago ?? 0;
    const nearHiding = c.clusters.some(cluster => cluster.dist <= 5);
    answers.hiding = noul(.3 + hidShare * .45 * influence + (nearHiding ? .2 : 0) - elapsed / 60 + (lkp?.pace === 'crawling' ? .1 : 0));
    // A search spreads outward from the last sighting as time passes.
    const spread = 3 + (situation.intruder.reach || 0) * .6;
    for (const zone of c.zones) {
      const align = Number.isFinite(heading) && zone.dist > 0 ? Math.cos(wrapAngle(zone.dir - heading)) : 0;
      zoneScores[zone.id] = (zone.reachable ? 1 : .25) * Math.exp(-zone.dist / spread) + (zone.id === lkp?.zone && elapsed < 12 ? .3 : 0)
        + (zone.hide ? .15 * answers.hiding.noul : 0) + align * .25 + influence * 1.1 * Math.min(1, zone.tendency / 3) + pull(zone.id) * .5
        - (zone.searched != null ? (zone.searched < 20 ? .6 : zone.searched < 40 ? .3 : 0) : 0) - (situation.plan?.status?.startsWith('predicted') && predicted === zone.name ? .4 : 0)
        - (zone.id === 'duct' || zone.id === 'culvert' ? .4 : 0);
    }
    answers.whereabouts = choose(zoneScores, random, .26, .1);
    const clusterScores = { none: .25 };
    for (const cluster of c.clusters) {
      clusterScores[cluster.id] = 1 / (1 + cluster.dist / 6) + influence * .5 * Math.min(1, cluster.found / 2) + influence * .6 * Math.min(1, cluster.tendency / 2)
        + (cluster.type === 'locker' ? .12 : 0) - (cluster.checked != null && cluster.checked < 25 ? .7 : 0);
    }
    answers.cluster = choose(clusterScores, random, .25, .1);
    const mass = answers.whereabouts.probabilities;
    const blockScores = {};
    for (const exit of c.exits) {
      blockScores[exit.id] = (mass[exit.to] || 0) * 1.4 + (exit.to === 'server' || exit.to === 'helipad' ? .3 : 0) + pull(exit.to) * .6
        + influence * .8 * share(td.escapes, exit.to) - (exit.guarded ? .5 : 0) - (exit.dist ?? 6) / 30;
    }
    answers.block = choose(blockScores, random, .25, .1);
    answers.search = choose({
      sweep: .35 + answers.whereabouts.confidence * .7,
      fan: situation.force.free >= 3 ? .3 + (1 - answers.whereabouts.confidence) * .6 : .05,
      trap: .2 + (breached ? .45 : 0) + (elapsed > 15 ? .2 : 0),
      probe: .1 + (answers.hiding.noul - .4) * 1.4 + (clusterScores[answers.cluster.choice] > .7 ? .2 : 0),
    }, random, .22, .1);
    const commitBase = { normal: .9, hard: 1.6, extreme: 2.3 }[situation.difficulty] ?? 1;
    answers.commit = score(commitBase + (breached ? .5 : 0));
    if (kind === 'sweep') {
      const fresh = situation.evidence.some(item => item.ago < 8 && !item.cleared);
      answers.continue = noul(.95 - Math.min(1, elapsed / Math.max(10, situation.rules.search)) * .85 + (fresh ? .3 : 0));
    }
    answers.level = score(2.2);
    return answers;
  }

  if (kind === 'anomaly') {
    const event = situation.event || { kind: 'noise', loud: 2 };
    const serious = { body: .97, corpse: 1, missing: .92, breach: .99, keycard: .9, cameras: .85, glimpse: .82 }[event.kind];
    const nearCritical = ['server', 'lab', 'lab_back', 'helipad', 'security'].includes(event.zone);
    const decoyBias = Math.min(.5, td.distractionsPerAttempt * .12) * influence;
    answers.worth = noul(serious ?? (.38 + (event.loud || 0) / 12 + (nearCritical ? .2 : 0) + (situation.phase !== 'calm' ? .12 : 0) + decoyBias * .3 + (event.count > 1 ? .15 : 0)));
    const threat = { body: 3, corpse: 3, breach: 3, missing: 2.4, keycard: 2.4, cameras: 1.8, glimpse: 2 }[event.kind] ?? Math.min(2.2, .7 + (event.loud || 0) / 6 + (event.count > 1 ? .4 : 0));
    answers.threat = score(threat);
    const farFromObjective = (TO_SERVER[event.zone] ?? 6) >= 3;
    answers.decoy = noul(['noise', 'glimpse'].includes(event.kind) ? .18 + decoyBias + (farFromObjective ? .15 : 0) : .08);
    answers.responders = choose({
      one: .55,
      pair: threat >= 2.4 ? .8 : .1,
      one_and_cover: answers.decoy.noul >= .45 || (threat >= 2 && !breached) ? .7 : .2,
      none: answers.worth.noul < .5 ? .9 : 0,
    }, random, .2, .06);
    const secure = {};
    for (const post of c.posts) secure[post.id] = (post.id === (breached ? 'heli_west' : 'server_door') ? .6 : 0) + influence * .5 * Math.min(1, post.tendency / 2) + (post.id === 'lab_main_door' || post.id === 'duct_exit' ? .2 : 0);
    answers.secure = choose(secure, random, .25, .08);
    return answers;
  }
  return null;
}

/* ── Jev’s plan choices ────────────────────────────────────────────────────── */

const cloneAnswers = value => JSON.parse(JSON.stringify(value));
const choiceFor = id => id ? { type: 'choice', choice: id, confidence: .7, probabilities: { [id]: .7 } } : null;
const setChoice = (answers, key, id) => { const value = choiceFor(id); if (value) answers[key] = value; };
const setNoul = (answers, key, value) => { answers[key] = noul(value); };
const setScore = (answers, key, value) => { answers[key] = score(value); };
const sectorId = (c, id) => (c.sectors || []).find(item => item.id === id)?.id || c.sectors?.[0]?.id;
const postId = (c, id) => (c.posts || []).find(item => item.id === id)?.id || c.posts?.[0]?.id;
const exitId = (c, id) => (c.exits || []).find(item => item.id === id)?.id || c.exits?.[0]?.id;
const zoneId = (c, id) => (c.zones || []).find(item => item.id === id)?.id || c.zones?.[0]?.id;
const clusterId = (c, id) => (c.clusters || []).find(item => item.id === id)?.id || c.clusters?.[0]?.id || 'none';

function planDoctrines(kind, situation) {
  const c = situation.candidates || {}, breached = situation.objective?.breached;
  const firstExit = exitId(c), secondExit = exitId(c, c.exits?.[1]?.id);
  const topZone = zoneId(c), secondZone = zoneId(c, c.zones?.[1]?.id), topCluster = clusterId(c);
  const objectivePost = postId(c, breached ? 'heli_west' : 'server_door');
  if (kind === 'posture') {
    return [
      { id: 'hold', name: 'Hold current patrols', counter: 'bait', why: 'Keep the shift familiar and the reserve free to react.', risk: 'Predictable routes; a patient intruder can wait them out.', change: a => setScore(a, 'level', 1.6) },
      { id: 'fortify_server', name: 'Fortify the server', counter: 'server', why: 'Put the reserve on the lab approach and a sentry on the objective door.', risk: 'Thin cover in the warehouse and corridors.', change: a => { setChoice(a, 'focus', sectorId(c, 'lab')); setChoice(a, 'watch', postId(c, 'server_door')); setChoice(a, 'pattern', 'paired'); setNoul(a, 'probe', .8); setScore(a, 'level', 3); } },
      { id: 'watch_culvert', name: 'Watch the culvert route', counter: 'server', why: 'Cover the duct exit and the warehouse approach this intruder has used before.', risk: 'The lab and helipad are less reinforced.', change: a => { setChoice(a, 'focus', sectorId(c, 'warehouse')); setChoice(a, 'watch', postId(c, 'duct_exit')); setChoice(a, 'pattern', 'paired'); setNoul(a, 'probe', .7); setScore(a, 'level', 2.4); } },
      { id: 'bait_route', name: 'Bait a route', counter: 'bait', why: 'Leave one plausible way in lightly held and watch the exits around it.', risk: 'If the intruder ignores the bait, the shift is spent out of position.', change: a => { setChoice(a, 'focus', sectorId(c, 'corridors')); setChoice(a, 'watch', postId(c, 'gate')); setChoice(a, 'pattern', 'staggered'); setNoul(a, 'probe', .25); setScore(a, 'level', 1); } },
      { id: 'hunt', name: 'Hunt the intruder', counter: 'hunt', why: 'Pair guards and push toward the areas the dossier says this intruder uses.', risk: 'Leaves posts thin and makes a decoy more dangerous.', change: a => { setChoice(a, 'focus', sectorId(c, 'barracks')); setChoice(a, 'watch', postId(c, 'east_fence')); setChoice(a, 'pattern', 'paired'); setNoul(a, 'probe', .9); setScore(a, 'level', 3); } },
      { id: 'lockdown', name: 'Lock the facility down', counter: 'hide', why: 'Tighten routes and raise readiness; best when the intruder is already inside.', risk: 'Slow, obvious, and tiring for the guards.', change: a => { setChoice(a, 'focus', sectorId(c, 'lab')); setChoice(a, 'watch', postId(c, 'lab_main_door')); setChoice(a, 'pattern', 'tight'); setNoul(a, 'probe', 1); setScore(a, 'level', 3); } },
    ];
  }
  if (kind === 'contact') {
    const ambushExit = secondExit && secondExit !== firstExit ? secondExit : firstExit;
    return [
      { id: 'contain', name: 'Contain the sighting', counter: 'server', why: 'Pursue from the sighting and close the exits of the room.', risk: 'A fast intruder can slip through a door before it is covered.', change: a => { setChoice(a, 'heading', firstExit); setChoice(a, 'response', 'contain'); setNoul(a, 'intercept', .75); setNoul(a, 'hold_objective', .8); setScore(a, 'level', 2.5); } },
      { id: 'pincer', name: 'Pincer the route', counter: 'server', why: 'Pursue while a second guard takes the short route ahead.', risk: 'Needs a free guard and a genuinely shorter route.', change: a => { setChoice(a, 'heading', firstExit); setChoice(a, 'response', 'pincer'); setNoul(a, 'intercept', .9); setNoul(a, 'hold_objective', .6); setScore(a, 'level', 2.7); } },
      { id: 'swarm', name: 'Swarm the sighting', counter: 'hunt', why: 'Send every committed guard at the last sighting immediately.', risk: 'Leaves the objective and the exits open.', change: a => { setChoice(a, 'heading', firstExit); setChoice(a, 'response', 'swarm'); setNoul(a, 'intercept', .35); setNoul(a, 'hold_objective', .35); setScore(a, 'level', 3); } },
      { id: 'protect', name: 'Protect the objective', counter: 'helipad', why: 'Keep the server or helipad covered first, then push one guard at the report.', risk: 'The intruder may disappear while the posts hold.', change: a => { setChoice(a, 'heading', firstExit); setChoice(a, 'response', 'protect'); setNoul(a, 'intercept', .5); setNoul(a, 'hold_objective', .95); setScore(a, 'level', 2.2); } },
      { id: 'ambush', name: 'Ambush the far exit', counter: 'server', why: 'Let the intruder run and put the intercept on the exit beyond the sighting.', risk: 'If they go to ground instead, the ambush sees nothing.', change: a => { setChoice(a, 'heading', ambushExit); setChoice(a, 'response', 'pincer'); setNoul(a, 'intercept', 1); setNoul(a, 'hold_objective', .7); setScore(a, 'level', 2.8); } },
      { id: 'probe_hiding', name: 'Check the hiding spots', counter: 'hide', why: 'Treat the disappearance as a hiding problem and search close to the sighting.', risk: 'Slow; the intruder may already be moving.', change: a => { setChoice(a, 'heading', 'hide'); setChoice(a, 'response', 'contain'); setNoul(a, 'intercept', .6); setNoul(a, 'hold_objective', .7); setScore(a, 'level', 2.4); } },
    ];
  }
  if (kind === 'lost' || kind === 'sweep') {
    const plans = [
      { id: 'sweep', name: 'Sweep the likely room', counter: 'hide', why: 'Search the most likely room from the last sighting and hold its exits.', risk: 'Slow and predictable; a patient intruder can let the search pass.', change: a => { setChoice(a, 'whereabouts', topZone); setChoice(a, 'block', firstExit); setChoice(a, 'cluster', topCluster); setChoice(a, 'search', 'sweep'); setNoul(a, 'hiding', .5); setScore(a, 'commit', 1.6); setScore(a, 'level', 2.3); } },
      { id: 'fan', name: 'Fan out across rooms', counter: 'server', why: 'Split the search across several likely rooms instead of committing to one.', risk: 'A small force can be defeated in detail.', change: a => { setChoice(a, 'whereabouts', secondZone || topZone); setChoice(a, 'block', firstExit); setChoice(a, 'cluster', topCluster); setChoice(a, 'search', 'fan'); setNoul(a, 'hiding', .4); setScore(a, 'commit', 2.2); setScore(a, 'level', 2.6); } },
      { id: 'trap', name: 'Trap the exits', counter: 'bait', why: 'Hold the doors and make the intruder come to you.', risk: 'If they are already outside the ring, it is wasted time.', change: a => { setChoice(a, 'whereabouts', topZone); setChoice(a, 'block', firstExit); setChoice(a, 'cluster', topCluster); setChoice(a, 'search', 'trap'); setNoul(a, 'hiding', .6); setScore(a, 'commit', 2); setScore(a, 'level', 2.5); } },
      { id: 'probe', name: 'Probe the hiding spots', counter: 'hide', why: 'Check lockers, grass and crates near the disappearance before widening the search.', risk: 'Ignores the possibility that the intruder kept moving.', change: a => { setChoice(a, 'whereabouts', topZone); setChoice(a, 'block', firstExit); setChoice(a, 'cluster', topCluster); setChoice(a, 'search', 'probe'); setNoul(a, 'hiding', .85); setScore(a, 'commit', 1.4); setScore(a, 'level', 2.3); } },
      { id: 'lockdown', name: 'Lock down the sector', counter: 'hunt', why: 'Commit most of the force to a tight search and hold every exit.', risk: 'Leaves the rest of the facility quiet.', change: a => { setChoice(a, 'whereabouts', topZone); setChoice(a, 'block', firstExit); setChoice(a, 'cluster', topCluster); setChoice(a, 'search', 'trap'); setNoul(a, 'hiding', .5); setScore(a, 'commit', 3); setScore(a, 'level', 3); } },
    ];
    if (kind === 'sweep') plans.push({ id: 'stand_down', name: 'Stand down to heightened patrols', counter: 'leave', why: 'End the search before it empties the rest of the facility.', risk: 'If the intruder is still close, they get a free window.', change: a => { setChoice(a, 'whereabouts', topZone); setChoice(a, 'block', firstExit); setChoice(a, 'cluster', topCluster); setChoice(a, 'search', 'sweep'); setNoul(a, 'hiding', .4); setScore(a, 'commit', 1); setNoul(a, 'continue', .2); setScore(a, 'level', 2); } });
    return plans;
  }
  if (kind === 'anomaly') {
    const event = situation.event || { kind: 'noise' };
    return [
      { id: 'investigate', name: 'Investigate quietly', counter: 'server', why: 'Send a pair to look without abandoning the key posts.', risk: 'A decoy can pull two guards out of position.', change: a => { setNoul(a, 'worth', .9); setScore(a, 'threat', 2.4); setNoul(a, 'decoy', .25); setChoice(a, 'responders', 'pair'); setChoice(a, 'secure', objectivePost); } },
      { id: 'search', name: 'Treat it as the intruder', counter: 'hunt', why: event.kind === 'body' || event.kind === 'corpse' || event.kind === 'missing' ? 'A body or missing guard is strong evidence; search the area and keep a key post covered.' : 'Escalate the report and search the area instead of only glancing at it.', risk: 'Overcommits the force if the report is a decoy.', change: a => { setNoul(a, 'worth', 1); setScore(a, 'threat', 3); setNoul(a, 'decoy', .1); setChoice(a, 'responders', 'pair'); setChoice(a, 'secure', objectivePost); } },
      { id: 'cover', name: 'Check it with cover', counter: 'bait', why: 'One guard investigates while another holds the post the intruder may be trying to open up.', risk: 'The checker is alone if the report is genuine and armed.', change: a => { setNoul(a, 'worth', .85); setScore(a, 'threat', 2.2); setNoul(a, 'decoy', .6); setChoice(a, 'responders', 'one_and_cover'); setChoice(a, 'secure', objectivePost); } },
      { id: 'ignore', name: 'Log it and hold', counter: 'bait', why: 'Treat the report as noise and keep every post manned.', risk: 'If it is real, security gives up the initiative.', change: a => { setNoul(a, 'worth', .2); setScore(a, 'threat', .8); setNoul(a, 'decoy', .5); setChoice(a, 'responders', 'none'); setChoice(a, 'secure', objectivePost); } },
      { id: 'feint', name: 'Suspect a feint', counter: 'bait', why: 'Assume the report is meant to pull guards away and cover the likely real target.', risk: 'Ignores a genuine sighting while guarding the wrong place.', change: a => { setNoul(a, 'worth', .7); setScore(a, 'threat', 2.1); setNoul(a, 'decoy', .9); setChoice(a, 'responders', 'one_and_cover'); setChoice(a, 'secure', objectivePost); } },
    ];
  }
  return [];
}

const planSignature = plan => JSON.stringify({
  strategy: plan.strategy, summary: plan.summary, level: plan.level, prediction: plan.prediction,
  focus: plan.focus, watch: plan.watch, pattern: plan.pattern, probe: plan.probe,
  roles: plan.roles.map(role => ({ role: role.role, x: Math.round(role.x), y: Math.round(role.y), post: role.post, exit: role.exit, cluster: role.cluster, zone: role.zone })),
});

function buildPlans(kind, situation, sim) {
  const base = atomicAnswers(kind, situation, mulberry32((sim.seed ^ (kind.length * 7919) ^ (sim.decisionSerial * 104729)) >>> 0));
  if (!base) return [];
  const plans = [], seen = new Set();
  for (const doctrine of planDoctrines(kind, situation)) {
    const answers = cloneAnswers(base);
    doctrine.change?.(answers, situation.candidates || {}, situation);
    const plan = planFromAnswers(kind, answers, situation);
    if (!plan || !Array.isArray(plan.roles)) continue;
    const signature = planSignature(plan);
    if (seen.has(signature)) continue;
    seen.add(signature);
    plans.push({
      id: `${kind}:${doctrine.id}`, name: doctrine.name, summary: plan.summary,
      why: doctrine.why, risk: doctrine.risk, counter: doctrine.counter, roles: plan.roles.length, plan,
    });
  }
  return plans.slice(0, 6);
}

function localIntent(situation) {
  const beliefs = situation.beliefs?.intent || {};
  const scores = Object.fromEntries(INTENTS.map(id => [id, Number.isFinite(beliefs[id]) ? beliefs[id] : 1 / INTENTS.length]));
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const choice = entries[0]?.[0] || 'server';
  const total = entries.reduce((sum, [, value]) => sum + value, 0) || 1;
  const probabilities = Object.fromEntries(entries.map(([id, value]) => [id, Math.round(value / total * 1000) / 1000]));
  return { type: 'choice', choice, confidence: probabilities[choice] ?? null, probabilities };
}

/** Fixture answers for the complete question set. Live play never uses this. */
export function localAnswers(kind, situation, random = Math.random) {
  const questions = shadowQuestions(kind, situation);
  if (!questions) return null;
  const answers = atomicAnswers(kind, situation, random);
  if (!answers) return null;
  if (questions.plan) {
    const intent = localIntent(situation);
    const plans = situation.candidates?.plans || [];
    const preferred = plans.find(item => item.counter === intent.choice) || plans[0];
    if (!preferred) return null;
    answers.intent = intent;
    answers.plan = {
      type: 'choice', choice: preferred.id, confidence: .55,
      probabilities: Object.fromEntries(plans.map(item => [item.id, item.id === preferred.id ? .55 : Math.round(.45 / Math.max(1, plans.length - 1) * 1000) / 1000])),
    };
  }
  return answers;
}
