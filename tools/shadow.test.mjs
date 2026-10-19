// Run with: node --test tools/shadow.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE, START, TERMINAL, EXTRACTION, ZONES, POSTS, PORTALS, MAP, kindAt, zoneAt } from '../src/client/shadow-level.js';
import { findPath, playerWalk, guardWalk, lineClear, soundField, index, walkableLine } from '../src/client/shadow-nav.js';
import { ShadowSim } from '../src/client/shadow-engine.js';
import { buildSituation, localAnswers, emptyDossier, recordMission, dossierInsights, jevState } from '../src/client/shadow-commander.js';
import { DECISION_KINDS, shadowQuestions, readAnswers, planFromAnswers } from '../src/shared/shadow-jev.js';

const at = (tx, ty) => ({ x: tx * TILE + 8, y: ty * TILE + 8 });
const crawl = (x, y) => playerWalk(x, y, true);
const quiet = sim => { for (const g of sim.guards) { g.x = 2 * TILE; g.y = 1 * TILE + 8; g.route = [{ x: g.x, y: g.y, hold: 999, face: Math.PI }]; g.routeIndex = 0; g.task = null; } };
const stepFor = (sim, seconds, input = {}) => { for (let t = 0; t < seconds; t += 1 / 60) sim.step(1 / 60, input); };

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
  const sim = new ShadowSim({ seed: 3, mode: 'commander' });
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
  const sim = new ShadowSim({ seed: 5, mode: 'commander', difficulty: 'normal' });
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

  const quietSim = new ShadowSim({ seed: 5, mode: 'commander', difficulty: 'normal' });
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
  const make = () => { const sim = new ShadowSim({ seed: 11, mode: 'commander' }); quiet(sim); return sim; };
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
  const sim = new ShadowSim({ seed: 2, mode: 'commander', dossier: recordMission(emptyDossier(), { outcome: 'captured', entry: 'culvert', labEntry: 'duct', escapes: ['warehouse'], vanish: ['warehouse:locker'], foundIn: ['locker'], afterDetect: ['hid'] }) });
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
    assert.ok(readAnswers(kind, answers, situation), kind + ': local answers satisfy the contract');
    const plan = planFromAnswers(kind, answers, situation);
    for (const role of plan.roles) assert.ok(Number.isFinite(role.x) && Number.isFinite(role.y), `${kind}: ${role.role} has a position`);
  }
});

test('malformed Jev answers are rejected question by question and filled from the local model', () => {
  const sim = new ShadowSim({ seed: 4, mode: 'commander' });
  sim.net.lastSeen = { ...at(36, 14), at: sim.t, zone: 'corr_e', heading: 0, pace: 'running' };
  const situation = buildSituation(sim, 'contact', null);
  const local = localAnswers('contact', situation, () => .5);
  assert.equal(readAnswers('contact', { heading: { type: 'choice', choice: 'the moon' } }, situation, null), null, 'nothing usable');
  const exit = Object.keys(shadowQuestions('contact', situation).heading.criteria)[0];
  const merged = readAnswers('contact', { heading: { type: 'choice', choice: exit, confidence: .8, probabilities: { [exit]: .8 } }, response: { type: 'choice', choice: 'nuke' }, intercept: { type: 'noul', noul: 7 } }, situation, local);
  assert.equal(merged.heading.choice, exit);
  assert.equal(merged.response, local.response, 'an unknown response falls back');
  assert.equal(merged.intercept.noul, 1, 'a probability is clamped');
  const plan = planFromAnswers('contact', { ...merged, response: { type: 'choice', choice: 'pincer', confidence: .7 }, intercept: { type: 'noul', noul: .9 } }, situation);
  assert.deepEqual(plan.roles.slice(0, 2).map(role => role.role), ['pursue', 'intercept'], 'a pincer pursues and sends an interceptor around');
});

test('Jev answers replace the local plan when they arrive in time; failures and late answers keep the local plan', async () => {
  const situationAnswers = (kind, situation) => {
    const answers = localAnswers(kind, situation, () => .9);
    if (answers.response) answers.response = { type: 'choice', choice: 'swarm', confidence: .9, probabilities: { swarm: .9 } };
    return answers;
  };
  const sim = new ShadowSim({ seed: 8, mode: 'commander', remote: async (kind, situation) => situationAnswers(kind, situation) });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(sim.decisions[0].source, 'jev', 'the posture came from Jev');
  sim.net.lastSeen = { ...at(36, 14), at: sim.t, zone: 'corr_e', heading: 0, pace: 'running' };
  const contact = sim.decide('contact', null);
  assert.equal(contact.source, 'local', 'guards get orders before Jev answers');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(contact.source, 'jev');
  assert.equal(contact.plan.strategy, 'swarm');

  const failing = new ShadowSim({ seed: 8, mode: 'commander', remote: async () => { throw new Error('unreachable'); } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(failing.decisions[0].source, 'local');
  assert.match(failing.decisions[0].status, /local kept/);

  const releases = [];
  const slow = new ShadowSim({ seed: 8, mode: 'commander', remote: (kind, situation) => new Promise(resolve => releases.push(() => resolve(situationAnswers(kind, situation)))) });
  const first = slow.decisions[0];
  slow.decide('anomaly', { kind: 'noise', ...at(10, 18), label: 'a clatter', at: 0, loud: 3 });
  await new Promise(resolve => setTimeout(resolve, 5));
  releases[0]();
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(first.source, 'local', 'an answer for a superseded decision is ignored');
  assert.match(first.status, /superseded/);
});

test('a prediction contradicted by fresh evidence triggers a new plan', () => {
  const sim = new ShadowSim({ seed: 9, mode: 'commander' });
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
  const sim = new ShadowSim({ seed: 12, mode: 'commander', difficulty: 'extreme' });
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
  const sim = new ShadowSim({ seed: 13, mode: 'commander' });
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

  const watches = dossierUsed => {
    const counts = {};
    for (let seed = 1; seed <= 40; seed++) {
      const sim = new ShadowSim({ seed, mode: 'commander', difficulty: 'hard', dossier: dossierUsed });
      const plan = sim.decisions[0].plan;
      counts[plan.focus] = (counts[plan.focus] || 0) + 1;
      counts['watch:' + plan.watch] = (counts['watch:' + plan.watch] || 0) + 1;
    }
    return counts;
  };
  const fresh = watches(emptyDossier()), learned = watches(dossier);
  const culvertSide = counts => (counts['watch:culvert_mouth'] || 0) + (counts['watch:duct_exit'] || 0) + (counts['watch:duct_grate'] || 0);
  assert.ok(culvertSide(learned) > culvertSide(fresh) + 10, `watch posts follow the habit (${culvertSide(fresh)} → ${culvertSide(learned)} of 40)`);
  assert.ok((learned.warehouse || 0) > (fresh.warehouse || 0), 'the warehouse is reinforced more often');
});

test('commander security coordinates where baseline security only converges', () => {
  const contact = mode => {
    const sim = new ShadowSim({ seed: 21, mode, difficulty: 'hard' });
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

test('Jev changes actual posture even when its summary is unchanged, and credits matching plans', async () => {
  let resolve;
  const sim = new ShadowSim({ seed: 36, mode: 'commander', remote: () => new Promise(done => { resolve = done; }) });
  const decision = sim.decisions[0], summary = decision.plan.summary;
  const changedLevel = decision.plan.level === 3 ? 1 : 3;
  await new Promise(done => setTimeout(done, 0));
  resolve({ ...decision.localAnswers, level: { type: 'score', score: changedLevel, confidence: .9 } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(decision.plan.summary, summary);
  assert.equal(sim.net.level, changedLevel, 'the changed score is applied despite matching prose');
  assert.equal(sim.net.planSource, 'jev');

  const matching = new ShadowSim({ seed: 37, mode: 'commander' });
  matching.remote = async () => matching.net.decision.localAnswers;
  const matched = matching.decide('posture', null);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(matched.source, 'jev');
  assert.equal(matching.net.planSource, 'jev', 'a validated matching plan is credited consistently in the overlay');
});

test('a delayed Jev answer cannot replace newer movement evidence in the same room', async () => {
  const sim = new ShadowSim({ seed: 38, mode: 'commander' });
  let resolve;
  sim.net.phase = 'alert'; sim.t = 10;
  sim.net.lastSeen = { ...at(36, 14), at: 10, zone: 'corr_e', heading: 0, pace: 'running' };
  sim.remote = () => new Promise(done => { resolve = done; });
  const decision = sim.decide('contact', null);
  await new Promise(done => setTimeout(done, 0));
  sim.t = 11;
  sim.net.lastSeen = { ...at(41, 14), at: 11, zone: 'corr_e', heading: 0, pace: 'running' };
  resolve(decision.localAnswers);
  await new Promise(done => setTimeout(done, 5));
  assert.equal(decision.source, 'local');
  assert.match(decision.status, /superseded by newer evidence/);
});

test('the knife kills silently, leaves blood and feeds the pistol from the body', () => {
  const sim = new ShadowSim({ seed: 41, mode: 'commander' });
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
  const sim = new ShadowSim({ seed: 42, mode: 'commander' });
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
  const sim = new ShadowSim({ seed: 43, mode: 'commander' });
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
  const sim = new ShadowSim({ seed: 44, mode: 'commander', dossier: d });
  const situation = buildSituation(sim, 'posture');
  assert.equal(situation.tendencies.killsPerAttempt, 2);
  assert.equal(localAnswers('posture', situation, () => .5).pattern.type, 'choice');
});

test('a colleague who finds a corpse reports a death, not a body to revive', () => {
  const sim = new ShadowSim({ seed: 45, mode: 'commander' });
  quiet(sim);
  const [watcher, body] = sim.guards;
  Object.assign(watcher, at(24, 22), { facing: 0, state: 'patrol', sees: false, bodyMeter: 0, bodyTarget: null });
  Object.assign(body, at(27, 22), { down: true, dead: true, hidden: false, carried: false, bodyClaimed: null });
  for (let i = 0; i < 90 && watcher.task?.role !== 'investigate'; i++) sim.perceiveBodies(watcher, 1 / 60);
  assert.equal(watcher.task?.role, 'investigate');
  assert.ok(sim.queue.some(message => message.kind === 'corpse'), 'the radio report names a corpse');
  assert.match(watcher.lastAction, /dead/);
});
