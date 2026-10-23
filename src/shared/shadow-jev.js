// Shadow Protocol's Jev contract: the commander's typed questions, the
// validation of Jev's answers, the belief update and the mapping from a
// chosen map-checked plan to live orders. Only complete, validated replies
// may become live commander orders.
// Provider contract: https://openrouter.ai/docs/guides/community/jev-tutorial
// Independent questions: https://docs.typesafe.ai/primitives
import { JEV_ENDPOINT, JEV_MODEL } from './girder-jev.js';
import { CAMERAS } from '../client/shadow-level.js';
import { DOOR_CONTROLS, FLOODLIGHTS } from './shadow-field.js';

export { JEV_ENDPOINT, JEV_MODEL };

export const SHADOW_GAME = Object.freeze({
  genre: 'top-down tactical stealth',
  role: 'You command the security force of a guarded research facility. One intruder is inside or approaching. You choose how the guards respond; game code moves them.',
  goal: 'Capture the intruder before they steal the lab data and reach the helipad. Protect the server room and the extraction routes.',
  knowledge: 'You only know what guards, cameras and radios have reported. Positions are reports with an age, not live tracking. Predictions can be wrong; fresh evidence beats an old plan.',
  bodies: 'A guard found unconscious can be revived by a colleague. A guard found dead cannot. A corpse or a gunshot is stronger evidence than a noise, and the intruder may be armed.',
  dossier: 'tendencies summarises what security has learned about this intruder over earlier attempts. Recent attempts weigh more. The intruder can change habits.',
  coordinates: 'Distances are in tiles. The facility is 64x44 tiles; north is up.',
  authority: 'You are the only tactical decision maker. Guards execute your orders and react to direct sight; there is no local commander filling gaps. Choose every requested answer.',
  field: 'You can seal one named doorway for 10 seconds, switch on one bank of floodlights for 20 seconds, and put one camera on a faster, longer-range sweep for 20 seconds. Seals block guards too, warn for one second and wait for an occupied threshold to clear. Repeating a live seal does not extend it. Damaged or disabled cameras remain unavailable. Field timers are mechanical limits, not new decisions.',
  beliefs: 'beliefs is security’s current probability over the intruder’s intent, not a fact. Update it from evidence. A low-confidence belief is a reason to gather information, not to commit everything.',
  plans: 'The game generates legal, map-checked plans. Choose the plan that best fits the evidence and your belief about the intruder; you still choose the field orders separately.',
});

export const DECISION_KINDS = Object.freeze(['posture', 'contact', 'lost', 'sweep', 'anomaly']);

export const INTENTS = Object.freeze(['server', 'helipad', 'hunt', 'bait', 'hide', 'leave']);
export const INTENT_NAMES = Object.freeze({
  server: 'Reach the lab server',
  helipad: 'Reach the helipad with the data',
  hunt: 'Hunt guards or clear a response',
  bait: 'Draw security into a trap',
  hide: 'Wait out the search',
  leave: 'Withdraw and try another way',
});

export const RESPONSES = Object.freeze({
  swarm: 'Every committed guard converges on the last sighting.',
  pincer: 'One guard pursues while another cuts through a shorter route to get ahead of the intruder.',
  contain: 'One guard pursues; others close the exits of the intruder’s area.',
  protect: 'One guard pursues; others secure the objective and the extraction route first.',
});
export const SEARCHES = Object.freeze({
  sweep: 'Search the most likely area systematically, starting from the last sighting.',
  fan: 'Split up: each guard checks a different likely area.',
  trap: 'Hold the exits and wait for the intruder to move; only one guard searches.',
  probe: 'Check the hiding spots near the last sighting: lockers, grass, crates.',
});
export const PATTERNS = Object.freeze({
  standard: 'Keep the normal patrol routes.',
  paired: 'Pair the reserve with a patrol so two guards cover each other.',
  staggered: 'Vary patrol timing so pauses are harder to predict.',
  tight: 'Shorten routes around the lab and the helipad.',
});
export const RESPONDERS = Object.freeze({
  one: 'The nearest free guard checks it alone.',
  pair: 'Two guards check it together.',
  one_and_cover: 'One guard checks it while another holds a key post.',
  none: 'Note it; nobody leaves their post.',
});
export const LEVELS = Object.freeze(['Relaxed — routine patrols', 'Normal — watchful patrols', 'Heightened — guards expect an intruder', 'Maximum — key posts held, routes closed']);
export const COMMIT = Object.freeze(['Two guards', 'Three guards', 'Most of the free guards', 'Everyone except the objective guard']);
export const THREAT = Object.freeze(['Nothing — wildlife or settling metal', 'Curious — worth a glance', 'Likely the intruder', 'Confirmed intrusion']);

const keys = list => (Array.isArray(list) ? list : []).filter(item => item && typeof item.id === 'string').slice(0, 8);
const criteria = (list, describe) => Object.fromEntries(keys(list).map(item => [item.id, describe(item)]));
const times = n => Number.isFinite(n) && n > 0 ? `${n.toFixed(1).replace(/\.0$/, '')}×` : 'never';
const noulCriteria = (yes, no) => ({ true: yes, false: no });

function zoneText(zone) {
  const bits = [`${zone.name}: ${zone.dist} tiles from the last sighting`];
  if (zone.reachable === false) bits.push('too far to have reached yet');
  if (zone.hide) bits.push(`${zone.hide} hiding spots`);
  if (zone.searched) bits.push(`searched ${zone.searched}s ago`);
  if (zone.tendency) bits.push(`intruder vanished or fled here ${times(zone.tendency)} before`);
  if (zone.note) bits.push(zone.note);
  return bits.join('; ') + '.';
}
function exitText(exit) {
  const bits = [`${exit.name}${exit.toward ? `, toward ${exit.toward}` : ''}`];
  if (exit.dist != null) bits.push(`${exit.dist} tiles from the last sighting`);
  if (exit.tendency) bits.push(`escape route used ${times(exit.tendency)} before`);
  if (exit.guarded) bits.push(`already watched by ${exit.guarded}`);
  if (exit.note) bits.push(exit.note);
  return bits.join('; ') + '.';
}
function clusterText(cluster) {
  const bits = [`${cluster.name}: ${cluster.dist} tiles from the last sighting`];
  if (cluster.found) bits.push(`intruder found hiding in this kind of spot ${times(cluster.found)}`);
  if (cluster.tendency) bits.push(`contact lost near here ${times(cluster.tendency)}`);
  if (cluster.checked) bits.push(`checked ${cluster.checked}s ago`);
  return bits.join('; ') + '.';
}
function postText(post) {
  const bits = [post.name];
  if (post.reason) bits.push(post.reason);
  if (post.tendency) bits.push(`intruder passed here ${times(post.tendency)} in earlier attempts`);
  return bits.join('; ') + '.';
}

/** The typed questions for one commander decision. Option keys come from the situation. */
function tacticalQuestions(kind, situation) {
  const c = situation?.candidates || {};
  if (kind === 'posture') {
    return {
      focus: { type: 'choice', instructions: 'Which sector should the reserve patrol reinforce this shift?', criteria: criteria(c.sectors, item => `${item.name}${item.reason ? ': ' + item.reason : ''}.`) },
      watch: { type: 'choice', instructions: 'Where should a sentry stand watch?', criteria: criteria(c.posts, postText) },
      pattern: { type: 'choice', instructions: 'How should the patrols run?', criteria: { ...PATTERNS } },
      level: { type: 'score', instructions: 'What security level should the force hold?', criteria: [...LEVELS] },
      probe: { type: 'noul', instructions: 'Should patrols check the hiding spots this intruder has used before?', criteria: noulCriteria('Patrols open lockers and walk the grass they pass.', 'Patrols keep moving.') },
    };
  }
  if (kind === 'contact') {
    return {
      heading: { type: 'choice', instructions: 'The intruder was just seen. Where will they go next?', criteria: { ...criteria(c.exits, exitText), hide: 'Goes to ground close by instead of leaving the area.' } },
      response: { type: 'choice', instructions: 'How should the force respond to the sighting?', criteria: { ...RESPONSES } },
      intercept: { type: 'noul', instructions: 'Is a free guard close enough to get ahead of the intruder by another route?', criteria: noulCriteria('Send an interceptor around.', 'Nobody can get ahead in time.') },
      hold_objective: { type: 'noul', instructions: 'Should the server-room guard stay at the objective instead of joining?', criteria: noulCriteria('The objective guard holds.', 'The objective guard joins the response.') },
      level: { type: 'score', instructions: 'What security level should the force move to?', criteria: [...LEVELS] },
    };
  }
  if (kind === 'lost' || kind === 'sweep') {
    const questions = {
      whereabouts: { type: 'choice', instructions: 'Contact is lost. Where is the intruder most likely now?', criteria: criteria(c.zones, zoneText) },
      hiding: { type: 'noul', instructions: 'Is the intruder hiding close to where they were last seen, rather than moving on?', criteria: noulCriteria('Hiding close to the last sighting.', 'Moving away.') },
      cluster: { type: 'choice', instructions: 'If they are hiding, which hiding spots should be checked first?', criteria: { ...criteria(c.clusters, clusterText), none: 'No hiding spot stands out.' } },
      block: { type: 'choice', instructions: 'Which route out should be blocked?', criteria: criteria(c.exits, exitText) },
      search: { type: 'choice', instructions: 'How should the search be run?', criteria: { ...SEARCHES } },
      commit: { type: 'score', instructions: 'How many guards should the search take off their posts?', criteria: [...COMMIT] },
    };
    if (kind === 'sweep') questions.continue = { type: 'noul', instructions: 'Is the intruder still nearby enough to keep searching?', criteria: noulCriteria('Keep searching.', 'Stand down and return to routes with heightened security.') };
    return questions;
  }
  if (kind === 'anomaly') {
    return {
      worth: { type: 'noul', instructions: 'Is this report worth sending a guard to?', criteria: noulCriteria('Investigate.', 'Log it and stay put.') },
      threat: { type: 'score', instructions: 'How serious is this report?', criteria: [...THREAT] },
      decoy: { type: 'noul', instructions: 'Could this be a distraction meant to pull guards away from somewhere important?', criteria: noulCriteria('Likely a distraction.', 'Probably genuine.') },
      responders: { type: 'choice', instructions: 'Who should respond?', criteria: { ...RESPONDERS } },
      secure: { type: 'choice', instructions: 'If guards leave their posts, which post must stay covered?', criteria: criteria(c.posts, postText) },
    };
  }
  return null;
}

function fieldQuestions() {
  return {
    doors: { type: 'choice', instructions: 'Which doorway should be temporarily sealed to shape the intruder route? This also blocks your guards.', criteria: {
      keep: 'Keep the existing seal or leave doors unsealed.', release: 'Release the active seal.',
      ...Object.fromEntries(DOOR_CONTROLS.map(item => [item.id, `Seal the ${item.name} for 10 seconds after a visible warning.`])),
    } },
    lights: { type: 'choice', instructions: 'Which floodlight bank should expose the area the intruder may use?', criteria: {
      keep: 'Keep current lighting.', off: 'Switch off the extra floodlights.',
      ...Object.fromEntries(FLOODLIGHTS.map(item => [item.id, `Turn on ${item.name} for 20 seconds; visibility and detection increase in the lit area.`])),
    } },
    camera: { type: 'choice', instructions: 'Which working camera should sweep faster and farther?', criteria: {
      keep: 'Keep current camera coverage.', routine: 'Return all cameras to routine sweeps.',
      ...Object.fromEntries(CAMERAS.map(item => [item.id, `Prioritize the ${item.name} for 20 seconds if it is online.`])),
    } },
  };
}

function intentQuestion(situation) {
  const belief = situation?.beliefs?.intent || {};
  return {
    type: 'choice',
    instructions: 'What is the intruder most likely trying to do now? This becomes security’s working theory until new evidence arrives.',
    criteria: Object.fromEntries(INTENTS.map(id => [id, `${INTENT_NAMES[id]}.${Number.isFinite(belief[id]) ? ` Current belief ${Math.round(belief[id] * 100)}%.` : ''}`])),
  };
}

function planQuestion(plans) {
  return {
    type: 'choice',
    instructions: 'Choose one coherent security plan. The options are legal, map-checked plans; you decide which trade-off fits the intruder and the evidence. You will give field orders separately.',
    criteria: Object.fromEntries(plans.map(item => {
      const summary = item.summary ? ` ${item.summary}.` : '';
      const why = item.why ? ` ${item.why}` : '';
      const risk = item.risk ? ` Risk: ${item.risk}` : '';
      return [item.id, `${item.name}.${summary}${why}${risk}`];
    })),
  };
}

export function shadowQuestions(kind, situation) {
  const plans = Array.isArray(situation?.candidates?.plans) ? situation.candidates.plans.filter(item => item && typeof item.id === 'string') : [];
  if (plans.length >= 2) {
    return {
      intent: intentQuestion(situation),
      plan: planQuestion(plans),
      ...fieldQuestions(),
    };
  }
  // Backward-compatible legal fallback for a situation without generated
  // plans: ask the atomic questions again rather than inventing a plan.
  const questions = tacticalQuestions(kind, situation);
  if (!questions) return null;
  return { ...questions, ...fieldQuestions() };
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

/**
 * Validates provider values without inventing missing answers. A partial reply
 * remains partial; readCompleteAnswers is required before issuing a live plan.
 */
export function readAnswers(kind, answers, situation) {
  const questions = shadowQuestions(kind, situation);
  if (!questions || !answers || typeof answers !== 'object' || Array.isArray(answers)) return null;
  const out = {};
  let usable = 0;
  for (const [name, question] of Object.entries(questions)) {
    const answer = answers[name];
    if (question.type === 'choice') {
      const options = Object.keys(question.criteria);
      if (answer?.type === 'choice' && options.includes(answer.choice)) {
        const probabilities = {};
        for (const option of options) if (Number.isFinite(answer.probabilities?.[option])) probabilities[option] = clamp(answer.probabilities[option], 0, 1);
        out[name] = { type: 'choice', choice: answer.choice, confidence: Number.isFinite(answer.confidence) ? clamp(answer.confidence, 0, 1) : null, probabilities };
        usable++;
      }
      // A partial provider reply must stay partial until the caller merges its
      // actual local answer. Inventing the first option hides a missing answer.
    } else if (question.type === 'score') {
      const top = question.criteria.length - 1;
      if (answer?.type === 'score' && Number.isFinite(answer.score)) {
        out[name] = { type: 'score', score: clamp(answer.score, 0, top), confidence: Number.isFinite(answer.confidence) ? clamp(answer.confidence, 0, 1) : null };
        usable++;
      }
    } else if (question.type === 'noul') {
      if (answer?.type === 'noul' && Number.isFinite(answer.noul)) {
        out[name] = { type: 'noul', noul: clamp(answer.noul, 0, 1) };
        usable++;
      }
    }
  }
  return usable ? out : null;
}

export function readCompleteAnswers(kind, raw, situation) {
  const questions = shadowQuestions(kind, situation), answers = readAnswers(kind, raw, situation);
  return questions && answers && Object.keys(questions).every(name => Object.hasOwn(answers, name)) ? answers : null;
}

const byId = (list, id) => (Array.isArray(list) ? list : []).find(item => item.id === id) || null;
const ranked = answer => [answer?.choice, ...Object.entries(answer?.probabilities || {}).sort((a, b) => b[1] - a[1]).map(([id]) => id)]
  .filter((id, i, list) => id && list.indexOf(id) === i);
const at = item => item ? { x: item.x, y: item.y } : null;
const commitCount = (score, available) => {
  const level = Math.round(clamp(score, 0, 3));
  return Math.max(0, Math.min(available, [2, 3, Math.ceil(available * .7), available][level]));
};

/**
 * Turns answers into a plan: a strategy, a prediction and a list of roles for
 * guards. Roles carry positions from the situation; the game assigns guards.
 */
export function planFromAnswers(kind, answers = {}, situation) {
  answers ||= {};
  // A plan-choice reply selects one of the locally generated, map-checked
  // plans. The game applies its own copy, so a provider cannot inject roles.
  const chosen = answers.plan?.choice && Array.isArray(situation?.plans)
    ? situation.plans.find(item => item.id === answers.plan.choice) : null;
  if (chosen?.plan) {
    const plan = {
      ...chosen.plan,
      roles: (chosen.plan.roles || []).map(role => ({ ...role })),
      confidence: { ...(chosen.plan.confidence || {}) },
      field: { ...(chosen.plan.field || {}) },
    };
    plan.field = {
      doors: answers.doors?.choice ?? plan.field.doors,
      lights: answers.lights?.choice ?? plan.field.lights,
      camera: answers.camera?.choice ?? plan.field.camera,
    };
    plan.intent = answers.intent?.choice || chosen.counter || null;
    plan.name = chosen.name;
    return plan;
  }
  const c = situation?.candidates || {};
  const lkp = situation?.intruder?.lastSeen || null;
  const available = Math.max(0, finite(situation?.force?.free, 3));
  const coordination = Math.max(1, finite(situation?.rules?.coordination, 3));
  const objectivePost = byId(c.posts, situation?.objective?.breached ? 'heli_west' : 'server_door') || byId(c.posts, 'server_door');
  const roles = [];
  const role = (name, target, extra = {}) => { if (target && Number.isFinite(target.x) && Number.isFinite(target.y)) roles.push({ role: name, x: target.x, y: target.y, ...extra }); };
  const plan = { kind, strategy: 'hold', summary: 'Hold positions', level: null, prediction: null, roles, confidence: {} };
  plan.field = { doors: answers.doors?.choice, lights: answers.lights?.choice, camera: answers.camera?.choice };
  for (const [name, answer] of Object.entries(answers || {})) {
    if (answer?.type === 'choice' || answer?.type === 'score') plan.confidence[name] = answer.confidence;
    else if (answer?.type === 'noul') plan.confidence[name] = Math.abs(answer.noul - .5) * 2;
  }
  if (answers?.level) plan.level = Math.round(clamp(answers.level.score, 0, 3));

  if (kind === 'posture') {
    const focus = byId(c.sectors, answers.focus?.choice), watch = byId(c.posts, answers.watch?.choice);
    plan.strategy = 'posture';
    plan.focus = focus?.id || null;
    plan.watch = watch?.id || null;
    plan.pattern = answers.pattern?.choice || 'standard';
    plan.probe = (answers.probe?.noul ?? 0) >= .5;
    plan.summary = `Reinforce ${focus?.name || 'the facility'}${watch ? ' · watch ' + watch.name : ''}`;
    if (watch) role('post', watch, { post: watch.id, face: watch.face, label: 'watch ' + watch.name });
    return plan;
  }

  if (kind === 'contact') {
    const heading = answers.heading?.choice, exit = byId(c.exits, heading);
    const response = answers.response?.choice || 'contain';
    const keepObjective = (answers.hold_objective?.noul ?? .5) >= .5;
    const intercept = (answers.intercept?.noul ?? 0) >= .5;
    plan.strategy = response;
    plan.keepObjective = keepObjective;
    plan.prediction = heading === 'hide' ? { zone: lkp?.zone, hide: true } : exit ? { zone: exit.to, exit: exit.id } : null;
    const where = lkp ? (c.zoneNames?.[lkp.zone] || lkp.zone) : 'the facility';
    role('pursue', lkp, { label: 'pursue the intruder', zone: lkp?.zone });
    if (response === 'swarm') {
      for (let i = 1; i < Math.min(coordination, available); i++) role('pursue', lkp, { label: 'converge on the sighting', zone: lkp?.zone });
      plan.summary = `Converge on ${where}`;
    } else if (response === 'pincer') {
      if (exit) role(intercept ? 'intercept' : 'block', exit.beyond || exit, { label: (intercept ? 'intercept beyond ' : 'cut off ') + exit.name, zone: exit.to, exit: exit.id, face: exit.face });
      role('pursue', lkp, { label: 'second pursuer', zone: lkp?.zone });
      plan.summary = exit ? `Pincer: pursue and cut off ${exit.name}` : `Pincer in ${where}`;
    } else if (response === 'contain') {
      const exits = [exit?.id, ...ranked(answers.heading)].filter((id, index, list) => id && id !== 'hide' && list.indexOf(id) === index).map(id => byId(c.exits, id)).filter(Boolean);
      for (const item of exits.slice(0, 2)) role('block', item, { label: 'close ' + item.name, zone: item.zone, exit: item.id, face: item.face });
      if (heading === 'hide') { const spot = byId(c.clusters, ranked(answers.cluster)[0]) || c.clusters?.[0]; if (spot) role('probe', spot, { cluster: spot.id, label: 'check ' + spot.name }); }
      plan.summary = `Contain the intruder in ${where}`;
    } else {
      if (!situation?.objective?.breached && objectivePost) role('guard', objectivePost, { post: objectivePost.id, face: objectivePost.face, label: 'secure ' + objectivePost.name });
      const extraction = byId(c.posts, 'heli_west');
      if (situation?.objective?.breached && extraction) role('guard', extraction, { post: extraction.id, face: extraction.face, label: 'secure the helipad' });
      if (exit) role('block', exit, { label: 'block ' + exit.name, zone: exit.zone, exit: exit.id, face: exit.face });
      plan.summary = situation?.objective?.breached ? 'Protect the extraction route' : 'Protect the objective while pursuing';
    }
    if (intercept && response !== 'pincer' && exit) {
      // Reserve the flanking slot before optional reinforcements. Otherwise a
      // small force can silently truncate the very interception Jev chose.
      const target = exit.beyond || exit;
      if (Number.isFinite(target.x) && Number.isFinite(target.y)) roles.splice(response === 'protect' ? 2 : 1, 0, { role: 'intercept', x: target.x, y: target.y, label: 'intercept beyond ' + exit.name, zone: exit.to, exit: exit.id, face: exit.face });
    }
    if (response !== 'swarm' && response !== 'pincer' && available >= 4) role('pursue', lkp, { label: 'second pursuer', zone: lkp?.zone });
    roles.splice(Math.max(0, Math.min(coordination + 2, available)));
    return plan;
  }

  if (kind === 'lost' || kind === 'sweep') {
    const zone = byId(c.zones, answers.whereabouts?.choice) || c.zones?.[0] || null;
    const cluster = byId(c.clusters, answers.cluster?.choice);
    const block = byId(c.exits, answers.block?.choice) || c.exits?.[0] || null;
    const search = answers.search?.choice || 'sweep';
    const hiding = (answers.hiding?.noul ?? 0) >= .55;
    const count = Math.min(coordination + 1, commitCount(answers.commit?.score ?? 1, available));
    if (kind === 'sweep' && (answers.continue?.noul ?? 1) < .4) {
      plan.strategy = 'stand_down';
      plan.summary = 'Stand down · heightened patrols';
      plan.level = Math.max(1, Math.min(plan.level ?? 2, 2));
      return plan;
    }
    plan.strategy = search;
    plan.prediction = { zone: zone?.id || lkp?.zone || null, cluster: hiding && cluster ? cluster.id : null, hide: hiding };
    const zoneRole = (item, label) => item && role('search', item, { zone: item.id, label: label || 'search ' + item.name });
    if (hiding && cluster) role('probe', cluster, { cluster: cluster.id, label: 'check ' + cluster.name });
    const blockRole = () => block && role('block', block, { exit: block.id, zone: block.zone, face: block.face, label: 'block ' + block.name });
    if (search === 'sweep') {
      zoneRole(zone); blockRole();
      if (lkp && zone && lkp.zone !== zone.id) zoneRole(byId(c.zones, lkp.zone));
      zoneRole(zone, 'second sweep of ' + zone?.name);
    } else if (search === 'fan') {
      const ids = ranked(answers.whereabouts).slice(0, 3);
      zoneRole(byId(c.zones, ids[0])); blockRole();
      for (const id of ids.slice(1)) zoneRole(byId(c.zones, id));
    } else if (search === 'trap') {
      for (const id of [block?.id, ...ranked(answers.block)].filter((id, index, list) => id && list.indexOf(id) === index).slice(0, 2)) {
        const item = byId(c.exits, id); if (item) role('block', item, { exit: item.id, zone: item.zone, face: item.face, label: 'hold ' + item.name });
      }
      if (objectivePost) role('guard', objectivePost, { post: objectivePost.id, face: objectivePost.face, label: 'secure ' + objectivePost.name });
      zoneRole(zone);
    } else {
      const spots = [cluster?.id, ...ranked(answers.cluster)].filter((id, index, list) => id && id !== 'none' && list.indexOf(id) === index).map(id => byId(c.clusters, id)).filter(Boolean);
      for (const spot of spots.slice(0, hiding ? 1 : 2)) if (!roles.some(item => item.cluster === spot.id)) role('probe', spot, { cluster: spot.id, label: 'check ' + spot.name });
      blockRole();
      zoneRole(zone);
    }
    roles.splice(count);
    const where = zone?.name || 'the area';
    plan.summary = search === 'trap' ? `Trap: hold the exits around ${where}` : search === 'fan' ? `Split up across ${where} and nearby` : search === 'probe' ? `Check hiding spots near ${where}` : `Sweep ${where}`;
    if (hiding && cluster) plan.summary += ` · suspect ${cluster.name}`;
    return plan;
  }

  if (kind === 'anomaly') {
    const event = situation?.event || null;
    const worth = (answers.worth?.noul ?? 0) >= .5;
    const decoy = (answers.decoy?.noul ?? 0) >= .5;
    const responders = answers.responders?.choice || 'one';
    const secure = byId(c.posts, answers.secure?.choice);
    plan.decoy = decoy;
    plan.threat = Math.round(clamp(answers.threat?.score ?? 1, 0, 3));
    if (!worth || responders === 'none') {
      plan.strategy = 'note';
      plan.summary = `Log ${event?.label || 'the report'} · hold positions`;
    } else {
      plan.strategy = 'investigate';
      role('investigate', event, { zone: event?.zone, label: 'investigate ' + (event?.label || 'the report') });
      if (responders === 'pair') role('investigate', event, { zone: event?.zone, label: 'back up the check' });
      plan.summary = `Investigate ${event?.label || 'the report'}`;
    }
    if (worth && plan.threat >= 3 && event && ['body', 'corpse', 'missing'].includes(event.kind)) role('search', event, { zone: event.zone, label: 'search around ' + (event.label || 'the report') });
    plan.level = plan.threat >= 2 ? 2 : null;
    if (secure && (decoy || responders === 'one_and_cover')) {
      role('guard', secure, { post: secure.id, face: secure.face, label: 'cover ' + secure.name });
      plan.summary += decoy ? ` · suspect a decoy, cover ${secure.name}` : ` · cover ${secure.name}`;
    }
    return plan;
  }
  return plan;
}

/** Validates a relay or direct response and returns complete typed answers, or null. */
export function answersFromResponse(kind, response, situation) {
  return readCompleteAnswers(kind, response?.answers, situation);
}
