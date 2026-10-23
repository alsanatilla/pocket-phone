// Run with: node --test tools/shadow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE, START, TERMINAL, EXTRACTION, ZONES, POSTS, PORTALS, MAP, kindAt, tileAt, zoneAt } from '../src/client/shadow-level.js';
import { findPath, playerWalk, guardWalk, lineClear, soundField, index, walkableLine } from '../src/client/shadow-nav.js';
import { ShadowSim, SPEED, DASH } from '../src/client/shadow-engine.js';
import { buildSituation, localAnswers, emptyDossier, recordMission, dossierInsights, jevState, initialMind, readMind, updateMind } from '../src/client/shadow-commander.js';
import { DECISION_KINDS, shadowQuestions, readAnswers, readCompleteAnswers, planFromAnswers } from '../src/shared/shadow-jev.js';
import { DOOR_CONTROLS, FLOODLIGHTS } from '../src/shared/shadow-field.js';

const at = (tx, ty) => ({ x: tx * TILE + 8, y: ty * TILE + 8 });
const crawl = (x, y) => playerWalk(x, y, true);
const quiet = sim => { for (const g of sim.guards) { g.x = 2 * TILE; g.y = 1 * TILE + 8; g.route = [{ x: g.x, y: g.y, hold: 999, face: Math.PI }]; g.routeIndex = 0; g.task = null; } };
const stepFor = (sim, seconds, input = {}) => { for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60, input); };
const jev = (kind, situation) => localAnswers(kind, situation, () => .5);

test('Jev’s field controls refer to real doors and reachable floodlight positions', () => {
  for (const control of DOOR_CONTROLS) {
    assert.ok(control.tiles.length > 0, control.id + ' has a door tile');
    for (const [tx, ty] of control.tiles) assert.ok(['D', 'K'].includes(tileAt(tx, ty)), `${control.id} names door tile ${tx},${ty}`);
  }
  for (const light of FLOODLIGHTS) assert.notEqual(kindAt(Math.floor(light.x), Math.floor(light.y)).walk, 'none', `${light.id} hangs over walkable ground`);
});

test('every way in reaches the server and the helipad, and guards cannot use the crawlways', () => {
  const terminal = [Math.floor(TERMINAL.x), Math.floor(TERMINAL.y) + 1];
  const pad = [EXTRACTION.rect[0] + 2, EXTRACTION.rect[1] + 2];
  for (const [name, via] of [['culvert', [5, 31]], ['gate', [31, 31]], ['fence', [58, 31]]]) {
    const inward = findPath(Math.floor(START.x / TILE), Math.floor(START.y / TILE), via[0], via[1], crawl);
    assert.ok(inward, `${name}: the start reaches the entry`);
    assert.ok(findPath(via[0], via[1], ...terminal, crawl), `${name}: the entry reaches the terminal`);
  }
  assert.ok(findPath(...terminal, ...pad, crawl), 'the terminal reaches the helipad');
  assert.equal(guardWalk(5, 31), false, 'guards cannot crawl the culvert');
  assert.equal(guardWalk(18, 8), false, 'guards cannot crawl the duct');
  for (const zone of ZONES) assert.ok(MAP.some((row, y) => [...row].some((_, x) => zoneAt(x * TILE + 8, y * TILE + 8) === zone.id)), zone.id + ' has tiles');
  for (const post of POSTS) assert.ok(guardWalk(Math.floor(post.x), Math.floor(post.y)), post.id + ' stands on walkable ground');
});

test('walls block sight and sound; fences block neither sight nor sound; low crates hide only a crouched body', () => {
  const warehouse = at(17, 15), corridor = at(21, 15);
  assert.equal(lineClear(warehouse.x, warehouse.y, corridor.x, corridor.y), false, 'the warehouse wall blocks sight');
  assert.equal(lineClear(at(20, 30).x, at(20, 30).y, at(20, 33).x, at(20, 33).y), true, 'the fence is see-through');
  const guard = at(8, 13), behind = at(10, 17);
  assert.equal(lineClear(guard.x, guard.y, behind.x, behind.y, () => false, true), false, 'a crouched body behind crates is hidden');
  assert.equal(lineClear(guard.x, guard.y, behind.x, behind.y, () => false, false), true, 'a standing body is not');
  const heard = soundField(warehouse.x, warehouse.y, 3);
  assert.equal(heard.has(index(21, 15)), false, 'a knock does not carry through the wall');
  assert.equal(heard.has(index(17, 17)), true, 'it carries across the room');
});

test('a guard cannot see the player through a wall, even in range and facing them', () => {
  const sim = new ShadowSim({ seed: 3, mode: 'commander', remote: jev });
  quiet(sim);
  const g = sim.guards[0];
  Object.assign(g, at(21, 15), { facing: Math.PI, route: [{ ...at(21, 15), hold: 999, face: Math.PI }] });
  Object.assign(sim.player, at(16, 15));
  stepFor(sim, 3);
  assert.equal(g.meter, 0);
  assert.equal(sim.net.phase, 'calm');
  Object.assign(sim.player, at(24, 15));
  g.facing = 0; g.route = [{ ...at(21, 15), hold: 999, face: 0 }];
  stepFor(sim, 3);
  assert.ok(g.sees, 'with the wall out of the way the guard does see the player');
});

test('a sighting reaches command only by radio; silencing the spotter first keeps the alarm quiet', () => {
  const sim = new ShadowSim({ seed: 5, mode: 'commander', remote: jev, difficulty: 'normal' });
  quiet(sim);
  const g = sim.guards[0];
  Object.assign(g, at(24, 22), { facing: 0, route: [{ ...at(24, 22), hold: 999, face: 0 }] });
  Object.assign(sim.player, at(27, 22));
  let t = 0;
  while (!g.sees && t < 4) { sim.step(1 / 60, {}); t += 1 / 60; }
  assert.ok(g.sees);
  assert.equal(sim.net.phase, 'calm', 'command has not heard yet');
  sim.noCapture = true;
  stepFor(sim, sim.rules.report + sim.rules.radio + .3);
  assert.equal(sim.net.phase, 'alert', 'the report arrived after the report and radio delays');

  const quietSim = new ShadowSim({ seed: 5, mode: 'commander', remote: jev, difficulty: 'normal' });
  quiet(quietSim);
  const spotter = quietSim.guards[0];
  Object.assign(spotter, at(24, 22), { facing: 0, route: [{ ...at(24, 22), hold: 999, face: 0 }] });
  Object.assign(quietSim.player, at(27, 22));
  while (!spotter.sees) quietSim.step(1 / 60, {});
  quietSim.knockOut(spotter);
  stepFor(quietSim, 4);
  assert.notEqual(quietSim.net.phase, 'alert', 'nobody reported the intruder');
});

test('the commander never reads the player’s true position: unseen movement leaves its situation unchanged', () => {
  const make = () => { const sim = new ShadowSim({ seed: 11, mode: 'commander', remote: jev }); quiet(sim); return sim; };
  const a = make(), b = make();
  Object.assign(a.player, at(10, 40)); Object.assign(b.player, at(55, 40));
  stepFor(a, 2); stepFor(b, 2);
  for (const kind of ['posture', 'anomaly']) {
    const event = { kind: 'noise', x: at(10, 18).x, y: at(10, 18).y, label: 'a clatter', at: 2 };
    assert.deepEqual(buildSituation(a, kind, event), buildSituation(b, kind, event), kind);
  }
  const state = JSON.stringify(jevState(buildSituation(a, 'posture', null)));
  assert.ok(!state.includes('"player"'), 'no player object is sent to Jev');
});

test('every decision asks typed Choice, Score and Noul questions whose options are real places', () => {
  const sim = new ShadowSim({ seed: 2, mode: 'commander', remote: jev, dossier: recordMission(emptyDossier(), { outcome: 'captured', entry: 'culvert', labEntry: 'duct', escapes: ['warehouse'], vanish: ['warehouse:locker'], foundIn: ['locker'], afterDetect: ['hid'] }) });
  sim.net.lastSeen = { ...at(10, 18), at: sim.t, zone: 'warehouse', heading: 0, pace: 'running' };
  const event = { kind: 'noise', ...at(10, 18), label: 'a clatter', at: 0, loud: 4 };
  const portals = new Set(PORTALS.map(portal => portal.id));
  for (const kind of DECISION_KINDS) {
    const situation = buildSituation(sim, kind, event);
    const questions = shadowQuestions(kind, situation);
    const types = new Set(Object.values(questions).map(question => question.type));
    for (const type of types) assert.ok(['choice', 'score', 'noul'].includes(type));
    for (const [name, question] of Object.entries(questions)) {
      assert.ok(question.instructions.length > 10, `${kind}.${name} has instructions`);
      if (question.type === 'choice') assert.ok(Object.keys(question.criteria).length >= 2, `${kind}.${name} offers a real choice`);
      if (question.type === 'score') assert.ok(Array.isArray(question.criteria) && question.criteria.length === 4);
    }
    if (questions.block) for (const id of Object.keys(questions.block.criteria)) assert.ok(portals.has(id), id + ' is a real portal');
    const answers = localAnswers(kind, situation, () => .5);
    assert.ok(readCompleteAnswers(kind, answers, situation), kind + ': complete answers satisfy the contract');
    const plan = planFromAnswers(kind, answers, situation);
    for (const role of plan.roles) assert.ok(Number.isFinite(role.x) && Number.isFinite(role.y), `${kind}: ${role.role} has a position`);
  }
});

test('Jev chooses among coherent, map-checked plans and can tune the field', () => {
  const sim = new ShadowSim({ seed: 2, mode: 'commander', remote: jev });
  sim.net.lastSeen = { ...at(10, 18), at: sim.t, zone: 'warehouse', heading: 0, pace: 'running' };
  const event = { kind: 'noise', ...at(10, 18), label: 'a clatter', at: 0, loud: 4 };
  for (const kind of DECISION_KINDS) {
    const situation = buildSituation(sim, kind, event);
    assert.ok(situation.plans.length >= 2, kind + ': several plans are offered');
    assert.equal(new Set(situation.plans.map(item => item.id)).size, situation.plans.length, kind + ': plan ids are unique');
    assert.equal(situation.candidates.plans.length, situation.plans.length);
    for (const candidate of situation.plans) {
      assert.equal(candidate.plan.kind, kind);
      assert.ok(candidate.name && candidate.summary && candidate.why && candidate.risk, candidate.id + ' explains its trade-off');
      for (const role of candidate.plan.roles) assert.ok(Number.isFinite(role.x) && Number.isFinite(role.y), `${candidate.id}: ${role.role} has a position`);
    }
    const chosen = situation.plans.at(-1);
    const answers = localAnswers(kind, situation, () => .5);
    answers.plan = { type: 'choice', choice: chosen.id, confidence: .8, probabilities: { [chosen.id]: .8 } };
    answers.doors = { type: 'choice', choice: 'warehouse_east', confidence: .8 };
    const plan = planFromAnswers(kind, answers, situation);
    assert.equal(plan.name, chosen.name, kind + ': the chosen plan is applied');
    assert.equal(plan.field.doors, 'warehouse_east', kind + ': field orders remain Jev’s');
  }
});

test('malformed or partial Jev answers never become guessed orders', () => {
  const sim = new ShadowSim({ seed: 4, mode: 'commander', remote: jev });
  sim.net.lastSeen = { ...at(36, 14), at: sim.t, zone: 'corr_e', heading: 0, pace: 'running' };
  const situation = buildSituation(sim, 'contact', null);
  const local = localAnswers('contact', situation, () => .5);
  assert.equal(readAnswers('contact', { plan: { type: 'choice', choice: 'the moon' } }, situation), null, 'nothing usable');
  const planId = Object.keys(shadowQuestions('contact', situation).plan.criteria)[0];
  const partial = readAnswers('contact', { plan: { type: 'choice', choice: planId, confidence: .8 }, intent: { type: 'choice', choice: 'server', confidence: .8, probabilities: { server: 7 } } }, situation);
  assert.deepEqual(Object.keys(partial), ['intent', 'plan'], 'only valid questions survive');
  assert.equal(partial.plan.choice, planId);
  assert.equal(partial.intent.probabilities.server, 1, 'a probability is clamped, not guessed');
  assert.equal(readCompleteAnswers('contact', partial, situation), null, 'a partial reply cannot issue orders');
  const complete = local;
  assert.ok(readCompleteAnswers('contact', complete, situation), 'the fixture answers every question');
  const plan = planFromAnswers('contact', complete, situation);
  const chosen = situation.plans.find(item => item.id === complete.plan.choice);
  assert.equal(plan.name, chosen.name, 'the chosen candidate plan is applied');
  assert.ok(plan.roles.length >= 1);
});

test('Jev is the only source of orders: a complete reply commands, a failed reply freezes the field', async () => {
  const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
  const situationAnswers = (kind, situation) => {
    const answers = localAnswers(kind, situation, () => .9);
    if (kind === 'contact') {
      const swarm = situation.candidates.plans.find(item => item.id.endsWith(':swarm'));
      if (swarm) answers.plan = { type: 'choice', choice: swarm.id, confidence: .9, probabilities: { [swarm.id]: .9 } };
    }
    return answers;
  };
  const sim = new ShadowSim({ seed: 8, mode: 'commander', remote: async (kind, situation) => situationAnswers(kind, situation) });
  await tick(5);
  assert.equal(sim.decisions[0].source, 'jev', 'the opening posture came from Jev');
  assert.ok(sim.net.plan, 'the plan is Jev’s');
  sim.net.lastSeen = { ...at(36, 14), at: sim.t, zone: 'corr_e', heading: 0, pace: 'running' };
  const contact = sim.decide('contact', null);
  assert.equal(contact.source, 'pending', 'no local orders are issued while Jev answers');
  await tick(5);
  assert.equal(contact.source, 'jev');
  assert.equal(contact.plan.strategy, 'swarm');

  const failing = new ShadowSim({ seed: 8, mode: 'commander', remote: async () => { throw new Error('unreachable'); } });
  await tick(5);
  assert.equal(failing.commandBlocked, true, 'a failed command freezes the field');
  assert.match(failing.decisions[0].status, /mission paused/);
  assert.match(failing.net.commandError, /unreachable/);
  const frozen = failing.t;
  failing.step(.25, {});
  assert.equal(failing.t, frozen, 'time does not pass without a commander');

  failing.remote = async (kind, situation) => situationAnswers(kind, situation);
  failing.retryCommand();
  await tick(5);
  assert.equal(failing.commandBlocked, false);
  assert.equal(failing.net.commandError, null);
  failing.step(.25, {});
  assert.ok(failing.t > frozen, 'the field moves again after Jev answers');

  const releases = [];
  const slow = new ShadowSim({ seed: 8, mode: 'commander', remote: (kind, situation) => new Promise(resolve => releases.push(() => resolve(situationAnswers(kind, situation)))) });
  const first = slow.decisions[0];
  const second = slow.decide('anomaly', { kind: 'noise', ...at(10, 18), label: 'a clatter', at: 0, loud: 3 });
  await tick(5);
  assert.equal(releases.length, 1, 'the second request waits for the line to free up');
  releases[0]();
  await tick(5);
  assert.equal(first.status, 'superseded', 'an answer for a superseded decision is ignored');
  assert.equal(releases.length, 2, 'the queued decision is asked once the line frees');
  releases[1]();
  await tick(5);
  assert.equal(second.source, 'jev');
  assert.ok(second.plan, 'the queued decision still receives real orders');
});

test('a prediction contradicted by fresh evidence triggers a new plan', () => {
  const sim = new ShadowSim({ seed: 9, mode: 'commander', remote: jev });
  quiet(sim);
  sim.net.phase = 'alert';
  sim.net.lastSeen = { ...at(36, 14), at: sim.t, zone: 'corr_e', heading: 0, pace: 'running' };
  sim.net.prediction = { zone: 'bunks', at: sim.t, resolved: null };
  sim.net.lastDecisionAt = -10;
  const before = sim.decisions.length;
  sim.receive({ kind: 'sighting', from: 'cam-north', ...at(12, 18), at: sim.t, heading: Math.PI, pace: 'running' });
  assert.equal(sim.metrics.predictionsMiss, 1);
  assert.equal(sim.decisions.length, before + 1);
  assert.equal(sim.decisions[0].kind, 'contact');
  assert.match(sim.decisions[0].situation.plan.status, /contradicted/);
});

test('a downed guard misses the radio check, security escalates and rearranges patrols', () => {
  const sim = new ShadowSim({ seed: 12, mode: 'commander', remote: jev, difficulty: 'extreme' });
  const victim = sim.guards.find(g => g.reserve) || sim.guards[1];
  sim.knockOut(victim);
  Object.assign(sim.player, at(20, 41));
  stepFor(sim, sim.rules.checkin + 8);
  assert.ok(sim.net.missing.has(victim.id) || sim.net.found.has(victim.id), 'security noticed');
  const kinds = sim.decisions.map(decision => decision.kind + ':' + (decision.event?.kind || ''));
  assert.ok(kinds.some(kind => kind.startsWith('anomaly:missing') || kind.startsWith('anomaly:body')), 'command decided what to do about it');
  assert.ok(kinds.filter(kind => kind.startsWith('posture')).length >= 2, 'patrols were rearranged after the failure');
});

test('hiding in a locker in full view does not work', () => {
  const sim = new ShadowSim({ seed: 13, mode: 'commander', remote: jev });
  quiet(sim);
  const g = sim.guards[0];
  Object.assign(g, at(5, 18), { facing: Math.PI, route: [{ ...at(5, 18), hold: 999, face: Math.PI }] });
  Object.assign(sim.player, at(3, 18));
  sim.noCapture = true;
  while (!g.sees) sim.step(1 / 60, {});
  sim.enterLocker(sim.lockerNear(sim.player, 20));
  assert.ok(sim.player.locker);
  stepFor(sim, 4);
  assert.equal(sim.player.locker, null, 'the guard opened the locker');
  assert.equal(sim.metrics.foundHiding, 1);
});

test('the dossier fades old habits and shifts security toward repeated ones', () => {
  let dossier = emptyDossier();
  const habit = { outcome: 'captured', entry: 'culvert', labEntry: 'duct', escapes: ['warehouse'], vanish: ['warehouse:locker'], foundIn: [], afterDetect: ['hid'], distractions: 3, alerts: 1 };
  for (let i = 0; i < 3; i++) dossier = recordMission(dossier, habit);
  assert.ok(dossier.entries.culvert > 2);
  assert.ok(dossierInsights(dossier).some(line => /culvert/.test(line)));
  const faded = recordMission(dossier, { ...habit, entry: 'gate', labEntry: 'keycard', escapes: [], vanish: [] });
  assert.ok(faded.entries.culvert < dossier.entries.culvert, 'older attempts weigh less');

  const freshSim = new ShadowSim({ seed: 1, mode: 'commander', remote: jev, dossier: emptyDossier() });
  const learnedSim = new ShadowSim({ seed: 1, mode: 'commander', remote: jev, dossier });
  const freshBelief = initialMind(freshSim).intent, learnedBelief = initialMind(learnedSim).intent;
  assert.ok(learnedBelief.hide > freshBelief.hide, 'the locker habit raises the hiding theory');
  assert.ok(learnedBelief.bait > freshBelief.bait, 'the distraction habit raises the bait theory');

  const situation = buildSituation(learnedSim, 'posture');
  assert.ok(situation.plans.length >= 2, 'Jev gets real plan choices');
  const culvertPlan = situation.plans.find(item => item.id === 'posture:watch_culvert');
  assert.ok(culvertPlan, 'the culvert route is one of the plans');
  assert.equal(culvertPlan.plan.watch, 'duct_exit');
  const before = readMind(learnedSim).intent.hide;
  updateMind(learnedSim, { type: 'choice', choice: 'hide', confidence: .95, probabilities: { hide: .95, server: .05 } }, situation, 1);
  assert.ok(readMind(learnedSim).intent.hide > before, 'a validated intent answer updates the ledger');
});

test('commander security coordinates where baseline security only converges', () => {
  const contact = mode => {
    const sim = new ShadowSim({ seed: 21, mode, difficulty: 'hard', remote: mode === 'commander' ? jev : null });
    sim.noCapture = true;
    sim.receive({ kind: 'sighting', from: 'cam-north', ...at(36, 14), at: sim.t, heading: 0, pace: 'running' });
    stepFor(sim, sim.rules.radio + .2);
    return sim.guards.filter(g => g.task).map(g => g.task.role);
  };
  const baseline = contact('baseline'), commander = contact('commander');
  assert.ok(baseline.every(role => role === 'pursue' || role === 'post'), 'baseline: ' + baseline.join(','));
  assert.ok(commander.some(role => ['block', 'intercept', 'guard', 'probe'].includes(role)), 'commander: ' + commander.join(','));
});

test('sight lines cannot slip through a wall corner in either direction', () => {
  const a = at(17, 2), b = at(16, 3);
  assert.ok(guardWalk(17, 2) && guardWalk(16, 3));
  assert.equal(lineClear(a.x, a.y, b.x, b.y), false);
  assert.equal(lineClear(b.x, b.y, a.x, a.y), false);
});

test('a pursuing guard paths around low crates even when the standing player is visible over them', () => {
  const sim = new ShadowSim({ seed: 31, mode: 'baseline' });
  const g = sim.guards[0], target = at(10, 17);
  Object.assign(g, at(8, 13), { state: 'alert', sees: true, freeze: 0, lastSeen: { ...target, t: 0 } });
  assert.equal(lineClear(g.x, g.y, target.x, target.y), true, 'standing silhouettes are visible over the crate stack');
  assert.equal(walkableLine(g.x, g.y, target.x, target.y), false, 'the same line is not physically walkable');
  for (let i = 0; i < 240; i++) { sim.t += 1 / 60; sim.chase(g, 1 / 60); }
  assert.ok(Math.hypot(g.x - target.x, g.y - target.y) < 16, 'the guard gets around the crates instead of pushing into them');
});

test('camera tracking and startled guards use the last sighting after the player hides', () => {
  const sim = new ShadowSim({ seed: 32, mode: 'baseline' });
  const g = sim.guards[0], camera = sim.cameras[0];
  Object.assign(g, at(24, 22), { facing: 0, sees: true, freeze: 1, lastSeen: { ...at(27, 22), t: 0 } });
  Object.assign(camera, at(24, 22), { angle: 0, facing: 0, track: 2, lastSeen: { ...at(27, 22), t: 0 } });
  Object.assign(sim.player, at(24, 18), { hidden: 'duct' });
  sim.chase(g, .1);
  sim.updateCameras(.1);
  assert.equal(g.facing, 0, 'surprise does not let a guard turn toward an unseen live position');
  assert.equal(camera.angle, 0, 'the camera keeps looking at the last observed location');
  assert.equal(camera.lastSeen.y, at(27, 22).y);
});

test('a rescuer searches the last body location and cannot track or revive a hidden body', () => {
  const sim = new ShadowSim({ seed: 33, mode: 'baseline' });
  const [rescuer, body] = sim.guards;
  sim.guards = [rescuer, body];
  Object.assign(rescuer, at(8, 18), { facing: 0, state: 'investigate', task: { role: 'revive', ...at(10, 18), target: body.id, label: 'check body' } });
  Object.assign(body, at(2, 17), { down: true, hidden: true, bodyClaimed: rescuer.id });
  sim.revive(rescuer, 1 / 60);
  assert.deepEqual(rescuer.pathGoal, at(10, 18), 'orders use the observed location, not the relocated body');
  for (let i = 0; i < 480 && rescuer.task?.role === 'revive'; i++) { sim.t += 1 / 60; sim.revive(rescuer, 1 / 60); }
  assert.equal(body.down, true, 'a locker occupant is not revived remotely');
  assert.equal(body.hidden, true);
  assert.equal(rescuer.task.role, 'investigate', 'the rescuer examines the empty location');
  assert.equal(body.bodyClaimed, null, 'other guards can discover the body later');
});

test('a colleague can discover the same guard after a second takedown', () => {
  const sim = new ShadowSim({ seed: 34, mode: 'baseline' });
  const [rescuer, body] = sim.guards;
  sim.guards = [rescuer, body];
  Object.assign(rescuer, at(24, 22), { facing: 0, state: 'patrol', bodyTarget: body.id });
  Object.assign(body, at(26, 22), { down: false, bodyClaimed: rescuer.id });
  sim.net.found.add(body.id);
  sim.knockOut(body);
  assert.equal(rescuer.bodyTarget, null);
  sim.perceiveBodies(rescuer, .6);
  assert.equal(rescuer.task?.role, 'revive');
  assert.equal(rescuer.task?.target, body.id);
});

test('the interception counter requires an interceptor already in position and a break in contact', () => {
  const count = (role, options = {}) => {
    const sim = new ShadowSim({ seed: 35, mode: 'baseline' });
    const g = sim.guards[0];
    sim.t = 10; sim.net.phase = 'search';
    sim.net.lastSeen = { ...at(24, 22), at: 8, zone: 'corr_w' };
    Object.assign(g, at(26, 22), { sees: false, task: { role, ...at(26, 22), arrived: 9, decision: 2, ...options } });
    sim.spot(g);
    return sim.metrics.interceptions;
  };
  assert.equal(count('intercept'), 1);
  for (const role of ['post', 'investigate', 'return', 'guard', 'block', 'search']) assert.equal(count(role), 0, role);
  assert.equal(count('intercept', { arrived: undefined }), 0, 'still travelling');
  assert.equal(count('intercept', { x: 100, y: 100 }), 0, 'not at the intended interception position');
  assert.equal(count('intercept', { decision: undefined }), 0, 'not a commander assignment');
});

test('Jev chooses a different posture plan, and the choice is credited to Jev', async () => {
  let resolve;
  const sim = new ShadowSim({ seed: 36, mode: 'commander', remote: () => new Promise(done => { resolve = done; }) });
  const decision = sim.decisions[0];
  assert.equal(decision.plan, null, 'no plan exists before Jev answers');
  const answers = localAnswers('posture', decision.situation, () => .5);
  const chosen = decision.situation.plans.find(item => item.plan.level <= 1) || decision.situation.plans[0];
  answers.plan = { type: 'choice', choice: chosen.id, confidence: .9, probabilities: { [chosen.id]: .9 } };
  resolve(answers);
  await new Promise(done => setTimeout(done, 5));
  assert.equal(decision.plan.name, chosen.name);
  assert.equal(decision.plan.level, chosen.plan.level);
  assert.equal(sim.net.level, chosen.plan.level, 'the chosen plan’s level is applied');
  assert.equal(sim.net.planSource, 'jev');

  const matching = new ShadowSim({ seed: 37, mode: 'commander', remote: jev });
  matching.remote = async () => localAnswers('posture', matching.net.decision.situation, () => .5);
  const matched = matching.decide('posture', null);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(matched.source, 'jev');
  assert.equal(matching.net.planSource, 'jev', 'a validated plan is credited consistently in the overlay');
});

test('a delayed Jev answer is planned on the newest report in the same room, and dropped once the intruder is elsewhere', async () => {
  const tick = ms => new Promise(done => setTimeout(done, ms));
  const sim = new ShadowSim({ seed: 38, mode: 'commander', remote: jev });
  let resolve;
  sim.net.phase = 'alert'; sim.t = 10;
  sim.net.lastSeen = { ...at(36, 14), at: 10, zone: 'corr_e', heading: 0, pace: 'running' };
  sim.remote = () => new Promise(done => { resolve = done; });
  const decision = sim.decide('contact', null), answers = localAnswers('contact', decision.situation, () => .5);
  await tick(0);
  sim.t = 11;
  sim.net.lastSeen = { ...at(41, 14), at: 11, zone: 'corr_e', heading: 0, pace: 'running' };
  resolve(answers);
  await tick(5);
  assert.equal(decision.source, 'jev', 'a chase no longer throws Jev away');
  assert.match(decision.status, /newest report/);
  const pursue = decision.plan.roles.find(role => role.role === 'pursue');
  assert.ok(pursue.x > at(39, 14).x, 'the pursuer is sent to the newest sighting, not the one Jev was asked about');

  const other = new ShadowSim({ seed: 38, mode: 'commander', remote: jev });
  const releases = [];
  other.net.phase = 'alert'; other.t = 10;
  other.net.lastSeen = { ...at(36, 14), at: 10, zone: 'corr_e', heading: 0, pace: 'running' };
  other.remote = (kind, situation) => new Promise(done => releases.push(() => done(localAnswers(kind, situation, () => .5))));
  const stale = other.decide('contact', null);
  await tick(0);
  other.t = 11;
  other.net.lastSeen = { ...at(24, 14), at: 11, zone: 'corr_w', heading: Math.PI, pace: 'running' };
  releases[0]();
  await tick(5);
  assert.match(stale.status, /superseded by a fresh report/);
  assert.notEqual(other.net.decision, stale, 'a fresh area creates a fresh request');
  assert.equal(releases.length, 2, 'the fresh request is sent');
  releases[1]();
  await tick(5);
  assert.equal(other.net.decision.source, 'jev');
});

test('a decision that meets a busy Jev waits in line and is asked once the line frees up', async () => {
  const tick = ms => new Promise(done => setTimeout(done, ms));
  const sim = new ShadowSim({ seed: 39, mode: 'commander', remote: jev });
  quiet(sim);
  const answer = [];
  sim.remote = (kind, situation) => new Promise(done => answer.push(() => done(localAnswers(kind, situation, () => .5))));
  sim.net.phase = 'alert'; sim.t = 10;
  sim.net.lastSeen = { ...at(36, 14), at: 10, zone: 'corr_e', heading: 0, pace: 'running' };
  sim.decide('contact', null);
  await tick(0);
  const missed = sim.decide('contact', null);
  await tick(5);
  assert.equal(missed.status, 'awaiting jev');
  assert.equal(answer.length, 1, 'only one request is on the line');
  answer[0]();
  await tick(5);
  assert.equal(answer.length, 2, 'the missed decision is asked once Jev is free');
  answer[1]();
  await tick(5);
  assert.equal(missed.source, 'jev');
  assert.ok(missed.plan, 'the queued decision gets real orders');
});

test('Jev’s field orders move the playing field: seals, floodlights and camera priority', () => {
  const fieldAnswers = (kind, situation) => {
    const answers = localAnswers(kind, situation, () => .5);
    answers.doors = { type: 'choice', choice: 'warehouse_east', confidence: .9 };
    answers.lights = { type: 'choice', choice: 'warehouse', confidence: .9 };
    answers.camera = { type: 'choice', choice: 'cam-gate', confidence: .9 };
    return answers;
  };
  const sim = new ShadowSim({ seed: 71, mode: 'commander', remote: fieldAnswers });
  quiet(sim);
  assert.equal(sim.net.plan.field.doors, 'warehouse_east');
  assert.equal(sim.field.seal.id, 'warehouse_east');
  assert.equal(sim.field.light.id, 'warehouse');
  assert.equal(sim.field.camera.id, 'cam-gate');

  const beforeLight = new ShadowSim({ seed: 71, mode: 'commander', remote: jev });
  const base = beforeLight.lightAt(10 * TILE + 8, 18 * TILE + 8);
  sim.step(1.05, {});
  assert.equal(sim.isSealed(19, 18), true, 'the warehouse east door seals after the warning');
  assert.equal(sim.guardPassable(19, 18), false, 'guards cannot walk through the seal');
  Object.assign(sim.player, at(17, 18));
  stepFor(sim, 1, { move: { x: 1, y: 0 } });
  assert.ok(sim.player.x < 19 * TILE, 'the operative cannot walk through either');
  assert.ok(sim.lightAt(10 * TILE + 8, 18 * TILE + 8) > base + .2, 'the floodlight brightens the warehouse');
  const priority = sim.cameras.find(camera => camera.id === 'cam-gate');
  sim.updateCameras(1 / 60);
  assert.ok(priority.range > 8.5 * TILE, 'the chosen camera sees farther');
  stepFor(sim, 18.1, {});
  assert.equal(sim.isSealed(19, 18), false, 'the seal expires');
  assert.equal(sim.field.light, null, 'the floodlight expires');
  assert.equal(sim.field.camera, null, 'camera priority expires');
  sim.updateCameras(1 / 60);
  assert.equal(priority.range, 8.5 * TILE, 'the camera returns to routine range');
});

test('Jev opens the shift from the dossier, speaks its orders by name, and a guard answers', () => {
  const dossier = recordMission(emptyDossier(), { outcome: 'extracted', entry: 'culvert', labEntry: 'duct', escapes: [], vanish: [], foundIn: [], afterDetect: [] });
  const sim = new ShadowSim({ seed: 9, mode: 'commander', remote: jev, dossier });
  const opening = sim.radio.at(-1);
  assert.equal(opening.from, 'Jev');
  assert.match(opening.text, /got out/);
  assert.match(opening.text, /west culvert/);
  quiet(sim);
  sim.net.phase = 'alert';
  sim.net.lastSeen = { ...at(36, 14), at: sim.t, zone: 'corr_e', heading: 0, pace: 'running' };
  const decision = sim.decide('contact', null);
  const line = sim.radio[0];
  assert.equal(line.from, 'Jev');
  const ordered = sim.guards.filter(g => g.pendingTask?.decision === decision.id);
  assert.ok(ordered.length >= 2, 'a contact commits several guards');
  assert.ok(ordered.filter(g => line.text.includes(g.name + ',') || line.text.includes(g.name + ' and')).length >= 2, `orders name the guards: ${line.text}`);
  assert.doesNotMatch(line.text, /pursue the intruder|second pursuer|·/, 'orders are spoken, not a log');
  stepFor(sim, sim.rules.radio + .2);
  assert.ok(sim.radio.some(item => ordered.some(g => g.name === item.from)), 'one guard acknowledges');
  assert.ok(ordered.some(g => g.order?.x != null), 'orders are kept for drawing on the map');
  const baseline = new ShadowSim({ seed: 9, mode: 'baseline' });
  assert.ok(!baseline.radio.some(item => item.from === 'Jev'), 'the baseline guards have no commander');
});

test('the knife kills silently, leaves blood and feeds the pistol from the body', () => {
  const sim = new ShadowSim({ seed: 41, mode: 'commander', remote: jev });
  quiet(sim);
  const guard = sim.guards[0];
  Object.assign(guard, at(24, 22), { facing: 0, route: [{ ...at(24, 22), hold: 999, face: 0 }], routeIndex: 0 });
  Object.assign(sim.player, at(23, 22));
  const ammo = sim.player.ammo;
  sim.knife();
  assert.equal(sim.player.action?.kind, 'kill');
  stepFor(sim, .6);
  assert.equal(guard.dead, true);
  assert.equal(guard.down, true);
  assert.equal(sim.metrics.kills, 1);
  assert.equal(sim.metrics.takedowns, 0, 'a kill is not counted as a nonlethal takedown');
  assert.equal(sim.player.ammo, ammo + 1, 'the guard had a magazine');
  assert.ok(sim.blood.length > 0, 'the kill leaves blood');
  assert.ok(sim.events.some(event => event.type === 'kill'), 'the UI receives a kill event');
});

test('the pistol is loud, one shot kills and the shot creates a sound event', () => {
  const sim = new ShadowSim({ seed: 42, mode: 'commander', remote: jev });
  quiet(sim);
  const guard = sim.guards[0];
  Object.assign(guard, at(27, 22), { facing: Math.PI, route: [{ ...at(27, 22), hold: 999, face: Math.PI }], routeIndex: 0 });
  Object.assign(sim.player, at(24, 22));
  sim.player.ammo = 3;
  sim.shoot(at(27, 22));
  assert.equal(guard.dead, true);
  assert.equal(sim.metrics.kills, 1);
  assert.equal(sim.metrics.shots, 1);
  assert.equal(sim.player.ammo, 2);
  assert.ok(sim.tracers.length > 0);
  assert.ok(sim.rings.some(ring => ring.kind === 'gunshot'), 'guards can hear the shot');
  assert.ok(sim.blood.length > 0);
});

test('a dead guard cannot be revived by a colleague', () => {
  const sim = new ShadowSim({ seed: 43, mode: 'commander', remote: jev });
  quiet(sim);
  const [rescuer, body] = sim.guards;
  Object.assign(rescuer, at(24, 22), { facing: 0, state: 'investigate', task: { role: 'revive', ...at(26, 22), target: body.id, label: 'check body' } });
  Object.assign(body, at(26, 22), { down: true, dead: true, hidden: false, bodyClaimed: rescuer.id });
  sim.revive(rescuer, 1 / 60);
  assert.equal(body.down, true, 'a corpse stays down');
  assert.equal(body.dead, true);
  assert.equal(rescuer.task?.role, 'investigate', 'the rescuer confirms the death instead of reviving');
});

test('the dossier records lethal habits and the commander plans for them', () => {
  const d = recordMission(emptyDossier(), {
    outcome: 'extracted', entry: 'gate', labEntry: 'keycard', data: true, alerts: 0, sightings: 0,
    takedownsKnown: 1, killsKnown: 2, distractions: 0, running: 0, predictionsHit: 0, predictionsMiss: 0,
    escapes: [], vanish: [], foundIn: [], afterDetect: [], time: 120, difficulty: 'normal', interceptions: 0,
    searches: 0, reacquired: 0, recoveries: 0, cameras: false,
  });
  assert.equal(d.kills, 2);
  assert.match(dossierInsights(d).join(' '), /Leaves bodies/);
  const sim = new ShadowSim({ seed: 44, mode: 'commander', remote: jev, dossier: d });
  const situation = buildSituation(sim, 'posture');
  assert.equal(situation.tendencies.killsPerAttempt, 2);
  assert.equal(localAnswers('posture', situation, () => .5).pattern.type, 'choice');
});

test('a colleague who finds a corpse reports a death, not a body to revive', () => {
  const sim = new ShadowSim({ seed: 45, mode: 'commander', remote: jev });
  quiet(sim);
  const [watcher, body] = sim.guards;
  Object.assign(watcher, at(24, 22), { facing: 0, state: 'patrol', sees: false, bodyMeter: 0, bodyTarget: null });
  Object.assign(body, at(27, 22), { down: true, dead: true, hidden: false, carried: false, bodyClaimed: null });
  for (let i = 0; i < 90 && watcher.task?.role !== 'investigate'; i++) sim.perceiveBodies(watcher, 1 / 60);
  assert.equal(watcher.task?.role, 'investigate');
  assert.ok(sim.queue.some(message => message.kind === 'corpse'), 'the radio report names a corpse');
  assert.match(watcher.lastAction, /dead/);
});

test('the operative slides around a door frame instead of stopping against it', () => {
  for (const offset of [0, 3, 4, 6]) {
    const sim = new ShadowSim({ seed: 1, mode: 'baseline' });
    quiet(sim);
    sim.noCapture = true;
    Object.assign(sim.player, { x: 10 * TILE + 8 + offset, y: 26 * TILE + 8 });
    let t = 0;
    while (t < 2 && sim.player.y > 23 * TILE + 8) { sim.step(1 / 60, { move: { x: 0, y: -1 } }); t += 1 / 60; }
    assert.ok(sim.player.y <= 23 * TILE + 8, `through the warehouse door from ${offset}px off-centre`);
  }
});

test('movement eases in and out quickly, and a wall stops momentum on its axis', () => {
  const sim = new ShadowSim({ seed: 1, mode: 'baseline' });
  quiet(sim);
  sim.noCapture = true;
  Object.assign(sim.player, at(36, 14));
  sim.step(1 / 60, { move: { x: 1, y: 0 } });
  assert.ok(sim.player.speed > 0 && sim.player.speed < SPEED.walk * .5, 'the first tick is not instant top speed');
  stepFor(sim, .15, { move: { x: 1, y: 0 } });
  assert.ok(sim.player.speed > SPEED.walk * .95, 'walking speed within about 0.15 s');
  stepFor(sim, .12);
  assert.equal(sim.player.speed, 0, 'stopped within about 0.12 s of letting go');
  Object.assign(sim.player, at(42, 14));
  stepFor(sim, .6, { move: { x: 1, y: 0 } });
  assert.equal(sim.player.vx, 0, 'the east corridor wall zeroes horizontal momentum');
  assert.ok(sim.player.x < 44 * TILE, 'the wall holds');
});

test('a shot without a mouse snaps to the guard ahead; download progress survives letting go', () => {
  const sim = new ShadowSim({ seed: 3, mode: 'commander', remote: jev });
  quiet(sim);
  sim.noCapture = true;
  const guard = sim.guards[0];
  Object.assign(guard, at(40, 14), { facing: 0, route: [{ ...at(40, 14), hold: 999, face: 0 }], routeIndex: 0 });
  Object.assign(sim.player, at(34, 14.3), { facing: .25 });
  sim.shoot(null);
  assert.equal(guard.dead, true, 'the assisted shot hit the guard 0.25 rad off the facing');
  const hacker = new ShadowSim({ seed: 4, mode: 'baseline' });
  quiet(hacker);
  Object.assign(hacker.player, { x: 31.5 * TILE, y: 5.2 * TILE + 10 });
  hacker.step(1 / 60, { interact: true, interactHeld: true });
  stepFor(hacker, 1.5, { interactHeld: true });
  stepFor(hacker, .1);
  assert.equal(hacker.player.action, null, 'letting go pauses the download');
  hacker.step(1 / 60, { interact: true, interactHeld: true });
  assert.ok(hacker.player.action?.t > 1.3, 'holding E again carries on from where it stopped');
});

test('holding the aim walks the operative toward the cursor instead of running', () => {
  const sim = new ShadowSim({ seed: 5, mode: 'baseline' });
  quiet(sim);
  Object.assign(sim.player, at(36, 14));
  const aim = at(36, 20);
  stepFor(sim, .4, { move: { x: 1, y: 0 }, run: true, aimHold: true, aim });
  assert.equal(sim.player.running, false, 'no running with the pistol drawn');
  assert.ok(sim.player.speed <= SPEED.walk + 1, 'walking pace');
  assert.ok(Math.abs(sim.player.facing - Math.atan2(aim.y - sim.player.y, aim.x - sim.player.x)) < .05, 'faces the cursor while strafing');
});

test('the cursor turns the operative, and a click can lunge at a guard in front', () => {
  const sim = new ShadowSim({ seed: 51, mode: 'baseline' });
  quiet(sim);
  sim.noCapture = true;
  Object.assign(sim.player, at(30, 14));
  const aim = at(30, 22);
  sim.step(1 / 60, { move: { x: -1, y: 0 }, aim, faceAim: true });
  assert.ok(Math.abs(sim.player.facing - Math.atan2(aim.y - sim.player.y, aim.x - sim.player.x)) < .05, 'faces the cursor while strafing');

  const target = sim.guards[0];
  Object.assign(target, at(32, 14), { facing: Math.PI, route: [{ ...at(32, 14), hold: 999, face: Math.PI }], routeIndex: 0, sees: false, meter: 0 });
  Object.assign(sim.player, at(30, 14));
  sim.knife(at(32, 14));
  assert.equal(sim.player.action?.kind, 'kill', 'a cursor-directed lunge does not require the guard to face away');
  stepFor(sim, .5);
  assert.equal(target.dead, true);
});

test('a discovered corpse turns a single check into a search from the body', () => {
  const sim = new ShadowSim({ seed: 61, mode: 'commander', remote: jev });
  quiet(sim);
  sim.noCapture = true;
  const witness = sim.guards[0], body = sim.guards[1];
  Object.assign(witness, at(24, 22), { facing: 0, state: 'patrol', sees: false, meter: 0, bodyMeter: 0, bodyTarget: null, task: null, route: [{ ...at(24, 22), hold: 999, face: 0 }], routeIndex: 0 });
  Object.assign(body, at(27, 22), { down: true, dead: true, hidden: false, carried: false, bodyClaimed: null });
  Object.assign(sim.player, at(18, 8), { hidden: 'duct', crouch: true });
  for (let i = 0; i < 120 && witness.task?.role !== 'investigate'; i++) sim.perceiveBodies(witness, 1 / 60);
  assert.equal(witness.task?.role, 'investigate', 'the guard sees the body');
  for (let i = 0; i < 360 && sim.net.phase !== 'search'; i++) sim.step(1 / 60, {});
  assert.equal(sim.net.phase, 'search', 'a corpse starts a security search');
  assert.ok(sim.metrics.searches >= 1);
  assert.equal(sim.net.plan?.kind, 'lost');
  assert.ok(sim.net.plan.roles.length >= 1, 'the plan assigns guards from the body location');
  assert.ok(sim.net.plan.roles.some(role => ['search', 'probe', 'block'].includes(role.role)), 'the response is a search, not only a look');
  assert.ok(sim.net.lastSeen && Math.abs(sim.net.lastSeen.x - body.x) < 1, 'the search starts where the body was found');
});

test('a guard who sees a colleague killed calls it in and starts a search', () => {
  const sim = new ShadowSim({ seed: 62, mode: 'commander', remote: jev });
  quiet(sim);
  sim.noCapture = true;
  const witness = sim.guards[0], victim = sim.guards[1];
  Object.assign(witness, at(24, 22), { facing: 0, state: 'patrol', sees: false, meter: 0, bodyMeter: 0, bodyTarget: null, task: null, route: [{ ...at(24, 22), hold: 999, face: 0 }], routeIndex: 0 });
  Object.assign(victim, at(27, 22), { facing: Math.PI, state: 'patrol', task: null });
  Object.assign(sim.player, at(18, 8), { hidden: 'duct', crouch: true });
  sim.killGuard(victim, 'knife');
  assert.equal(witness.task?.role, 'investigate', 'the witness reacts at the moment of the kill');
  assert.ok(sim.queue.some(message => message.kind === 'corpse'), 'the witness radios a corpse');
  stepFor(sim, 5);
  assert.equal(sim.net.phase, 'search', 'the witnessed kill starts a search');
  assert.equal(sim.net.plan?.kind, 'lost');
  assert.ok(sim.net.plan.roles.length >= 1);
});

test('a dash bursts about 60px, glides into a sprint, ignores a grab and stops at a wall', () => {
  const sim = new ShadowSim({ seed: 2, mode: 'baseline' });
  quiet(sim);
  Object.assign(sim.player, at(30, 14));
  const startX = sim.player.x;
  sim.step(1 / 60, { dash: true, move: { x: 1, y: 0 } });
  assert.equal(sim.player.move?.kind, 'dash');
  const firstTick = sim.player.x - startX;
  assert.ok(firstTick > 7, 'the launch is hard: ' + firstTick.toFixed(1) + 'px on the first tick');
  stepFor(sim, DASH.time + .02, { move: { x: 1, y: 0 } });
  assert.equal(sim.player.move, null, 'the dash ends on time');
  assert.ok(sim.player.speed > SPEED.walk, 'it hands sprint speed back to the stick');
  assert.ok(sim.player.x - startX > 58 && sim.player.x - startX < 80, 'about 60px, got ' + (sim.player.x - startX).toFixed(1));

  sim.step(1 / 60, { dash: true, move: { x: -1, y: 0 } });
  assert.equal(sim.player.move, null, 'no second dash inside the cooldown');
  stepFor(sim, DASH.cooldown - DASH.buffer * .5);
  sim.step(1 / 60, { dash: true, move: { x: -1, y: 0 } });
  stepFor(sim, DASH.buffer);
  assert.equal(sim.player.move?.kind, 'dash', 'a press just before the cooldown ends is buffered and fires');

  const grabbed = new ShadowSim({ seed: 2, mode: 'baseline' });
  quiet(grabbed);
  const g = grabbed.guards[0];
  Object.assign(g, at(30, 14), { facing: 0, sees: true, state: 'alert', freeze: 0, lastSeen: { ...at(31, 14), t: 0 } });
  Object.assign(grabbed.player, at(31, 14), { caught: grabbed.rules.captureTime - .05 });
  grabbed.step(1 / 60, { dash: true, move: { x: 1, y: 0 } });
  stepFor(grabbed, .1, { move: { x: 1, y: 0 } });
  assert.equal(grabbed.status, 'playing', 'a dashing body cannot be grabbed');

  Object.assign(sim.player, at(42, 14), { move: null, vx: 0, vy: 0 });
  sim.player.dashReadyAt = 0;
  sim.step(1 / 60, { dash: true, move: { x: 1, y: 0 } });
  stepFor(sim, .3);
  assert.ok(sim.player.x < 44 * TILE, 'the east corridor wall stops the dash');
});

test('a dash through a doorway bangs a shut door open and flattens the guard beyond it', () => {
  const sim = new ShadowSim({ seed: 3, mode: 'baseline' });
  quiet(sim);
  sim.noCapture = true;
  Object.assign(sim.player, at(17, 18), { facing: 0 });
  const door = sim.doors.get(index(19, 18));
  stepFor(sim, .5);
  assert.ok(door.open < .2, 'the warehouse east door starts shut');
  sim.step(1 / 60, { dash: true, move: { x: 1, y: 0 } });
  let widest = 0;
  for (let t = 0; t < .3; t += 1 / 60) { sim.step(1 / 60, {}); widest = Math.max(widest, door.open); }
  assert.ok(door.slamAt > 0 && widest === 1, 'the dash slammed it open');
  assert.ok(sim.rings.some(ring => ring.kind === 'slam') || sim.metrics.noises > 1, 'a slam is loud');
  assert.ok(sim.player.x > 19 * TILE + 8, 'and carried the operative through');

  const charge = new ShadowSim({ seed: 3, mode: 'baseline' });
  quiet(charge);
  charge.noCapture = true;
  const g = charge.guards[0];
  Object.assign(g, at(20, 18), { facing: 0, route: [{ ...at(20, 18), hold: 999, face: 0 }], routeIndex: 0 });
  Object.assign(charge.player, at(17, 18), { facing: 0 });
  charge.step(1 / 60, { dash: true, move: { x: 1, y: 0 } });
  stepFor(charge, .3);
  assert.equal(g.down, true, 'the guard in the doorway is knocked flat');
  assert.equal(g.dead, false, 'and is only knocked out');
});

test('crouching out of a sprint slides low and sweeps a guard off their feet', () => {
  const sim = new ShadowSim({ seed: 4, mode: 'baseline' });
  quiet(sim);
  sim.noCapture = true;
  const g = sim.guards[0];
  Object.assign(g, at(27, 14), { facing: 0, route: [{ ...at(27, 14), hold: 999, face: 0 }], routeIndex: 0 });
  Object.assign(sim.player, at(21, 14));
  stepFor(sim, .35, { move: { x: 1, y: 0 }, run: true });
  assert.equal(sim.player.running, true);
  sim.step(1 / 60, { move: { x: 1, y: 0 }, run: true, crouch: true });
  assert.equal(sim.player.move?.kind, 'slide');
  assert.equal(sim.player.crouch, true, 'a slide is low');
  stepFor(sim, .6, { move: { x: 1, y: 0 } });
  assert.equal(g.down, true, 'the slide took the guard down');
  assert.equal(sim.player.move, null);
  assert.equal(sim.player.crouch, true, 'it ends crouched');

  const walker = new ShadowSim({ seed: 4, mode: 'baseline' });
  quiet(walker);
  Object.assign(walker.player, at(21, 14));
  stepFor(walker, .3, { move: { x: 1, y: 0 } });
  walker.step(1 / 60, { move: { x: 1, y: 0 }, crouch: true });
  assert.equal(walker.player.move, null, 'crouching from a walk just crouches');
  assert.equal(walker.player.crouch, true);
});

test('a dash or a sprint at low cover vaults it, but never a wall or a fence', () => {
  const sim = new ShadowSim({ seed: 5, mode: 'baseline' });
  quiet(sim);
  sim.noCapture = true;
  Object.assign(sim.player, at(25, 26));
  sim.step(1 / 60, { dash: true, move: { x: 0, y: 1 } });
  assert.equal(sim.player.move?.kind, 'vault', 'dashing at the yard crates vaults them');
  stepFor(sim, .4);
  assert.equal(sim.player.move, null);
  assert.ok(sim.player.y > 29 * TILE, 'landed beyond two rows of crates');
  assert.equal(kindAt(Math.floor(sim.player.x / TILE), Math.floor(sim.player.y / TILE)).walk, 'all');

  const runner = new ShadowSim({ seed: 5, mode: 'baseline' });
  quiet(runner);
  runner.noCapture = true;
  Object.assign(runner.player, at(8, 27));
  stepFor(runner, .9, { move: { x: 1, y: 0 }, run: true });
  assert.ok(runner.player.x > 14 * TILE, 'sprinting into the west-lot crates hops over them');

  const fence = new ShadowSim({ seed: 5, mode: 'baseline' });
  quiet(fence);
  Object.assign(fence.player, at(20, 30));
  fence.step(1 / 60, { dash: true, move: { x: 0, y: 1 } });
  stepFor(fence, .4);
  assert.ok(fence.player.y < 31 * TILE, 'the perimeter fence cannot be vaulted');
});

test('a click with nobody in reach still swings, and a strike out of a dash reaches further', () => {
  const sim = new ShadowSim({ seed: 6, mode: 'baseline' });
  quiet(sim);
  sim.noCapture = true;
  Object.assign(sim.player, at(30, 14));
  const startX = sim.player.x;
  sim.knife(at(34, 14));
  assert.equal(sim.player.action?.kind, 'swing', 'an empty click is a swing, not a refusal');
  stepFor(sim, .25);
  assert.equal(sim.player.action, null);
  assert.ok(sim.player.x - startX > 6, 'the swing steps into the cut');

  const dash = new ShadowSim({ seed: 6, mode: 'baseline' });
  quiet(dash);
  dash.noCapture = true;
  const g = dash.guards[0];
  Object.assign(g, at(37, 14), { facing: 0, route: [{ ...at(37, 14), hold: 999, face: 0 }], routeIndex: 0 });
  Object.assign(dash.player, at(30, 14));
  dash.step(1 / 60, { dash: true, move: { x: 1, y: 0 } });
  stepFor(dash, .1);
  dash.step(1 / 60, { knife: true, aim: { x: g.x, y: g.y } });
  stepFor(dash, .6);
  assert.equal(g.dead, true, 'the strike pressed mid-dash fired as it ended and reached the guard');
});
