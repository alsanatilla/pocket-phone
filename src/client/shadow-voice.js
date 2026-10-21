// Shadow Protocol's radio voice. The commander's plans are typed data; this
// words them as the orders guards hear, addressed to guards by name, so the
// player can hear Jev command. It only phrases a plan: it never changes one.
import { ZONE_BY_ID, POST_BY_ID, SECTORS } from './shadow-level.js';

export const ENTRY_NAMES = Object.freeze({ culvert: 'the west culvert', gate: 'the main gate', fence: 'the cut east fence' });
export const LAB_NAMES = Object.freeze({ duct: 'the air duct', keycard: 'the keycard door', north: 'the lab north door', east: 'the lab east door' });

const zone = id => ZONE_BY_ID[id] ? 'the ' + ZONE_BY_ID[id].name : 'there';
const post = id => POST_BY_ID[id] ? 'the ' + POST_BY_ID[id].name : null;
const names = list => list.length < 3 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
const capital = text => text ? text[0].toUpperCase() + text.slice(1) : text;

/** One guard's order as spoken; `lead` is the first pursuer, for "back X up". */
export function orderPhrase(role, lead = null) {
  const label = role.label || '';
  switch (role.role) {
    case 'pursue':
      if (label === 'second pursuer' && lead) return `back ${lead} up`;
      return label === 'pursue the intruder' ? 'stay on them' : 'close in';
    case 'intercept': return `get ahead of them in ${zone(role.zone)}`;
    case 'search': return label.startsWith('search around') ? label : `sweep ${zone(role.zone)}`;
    case 'guard': return post(role.post) ? `lock down ${post(role.post)}` : label;
    case 'post': return post(role.post) ? `watch ${post(role.post)}` : label;
    case 'investigate': return label === 'back up the check' ? 'go with them' : 'check it out';
    case 'panel': return 'get the cameras back up';
    default: return label || role.role;
  }
}

function lead(kind, plan, event, n = 0) {
  if (kind === 'contact') {
    if (plan.prediction?.hide) return 'They will try to hide.';
    const toward = plan.prediction?.zone ? ` They are making for ${zone(plan.prediction.zone)}.` : '';
    const opener = { swarm: 'Everyone on them.', pincer: 'Pincer.', contain: 'Box them in.' }[plan.strategy]
      || (/extraction/.test(plan.summary) ? 'They have the data. Cover the way out.' : 'Protect the server.');
    return opener + toward;
  }
  if (kind === 'lost' || kind === 'sweep') {
    const where = plan.prediction?.zone ? zone(plan.prediction.zone) : 'the area';
    const head = kind === 'lost' ? (plan.prediction?.hide ? `They went to ground near ${where}.` : `They are in ${where}, or close.`)
      : ['Nothing yet. Keep looking.', `Still nothing. Try ${where}.`, 'They are still in here. Widen it.'][n % 3];
    const how = { trap: 'Hold the exits and let them come to us.', fan: 'Split up.', probe: 'Open every hiding spot.', sweep: '' }[plan.strategy] || '';
    return [head, how].filter(Boolean).join(' ');
  }
  if (kind === 'anomaly') {
    const what = event?.label ? capital(event.label) + (event.zone ? ` in ${zone(event.zone)}` : '') + '.' : 'A report.';
    if (plan.strategy === 'note') return `${what} Probably nothing. Hold positions.`;
    const read = plan.decoy ? 'Could be a decoy.' : ['Probably nothing, check anyway.', 'Worth a look.', 'Could be them.', 'That is them.'][plan.threat ?? 1];
    return `${what} ${read}`;
  }
  if (kind === 'posture') return `Rearranging patrols: extra eyes on ${SECTORS[plan.focus] || 'the facility'}.`;
  return '';
}

/**
 * The radio line for a decision: a lead that reads the situation, then the orders
 * by name. `issued` is [{ name, role }] in the order guards were assigned.
 */
export function orderLine({ kind, plan, issued = [], event = null, revised = false, n = 0 }) {
  if (plan.strategy === 'stand_down') return (revised ? 'Belay that. ' : '') + 'They are gone. Back to your routes, stay sharp.';
  const pursuer = issued.find(item => item.role.role === 'pursue')?.name || null;
  const grouped = new Map();
  for (const item of issued.slice(0, 4)) {
    const phrase = orderPhrase(item.role, item.name === pursuer ? null : pursuer);
    grouped.set(phrase, [...(grouped.get(phrase) || []), item.name]);
  }
  const orders = [...grouped].map(([phrase, who]) => `${names(who)}, ${phrase}.`);
  return [revised ? 'Belay that.' : '', lead(kind, plan, event, n), ...orders].filter(Boolean).join(' ');
}

/** What Jev says when a new shift starts, from the dossier and the posture it chose. */
export function openingLine(dossier, plan, watcher) {
  const last = dossier?.history?.[0];
  const bits = [];
  if (!dossier?.attempts || !last) bits.push('Quiet night. Standard routes, report anything that moves.');
  else {
    bits.push(last.outcome === 'extracted' ? 'Last time they got out with the data. Not tonight.'
      : last.outcome === 'captured' ? 'We caught them last time. They will be more careful.' : 'They turned back last time. They will be back.');
    if (last.entry && ENTRY_NAMES[last.entry]) bits.push(`They came in through ${ENTRY_NAMES[last.entry]}.`);
  }
  if (watcher && plan?.watch && post(plan.watch)) bits.push(`${watcher}, watch ${post(plan.watch)}.`);
  if (plan?.focus && SECTORS[plan.focus] && dossier?.attempts) bits.push(`Extra eyes on ${SECTORS[plan.focus]}.`);
  if (plan?.probe) bits.push('Open the lockers on your rounds.');
  return bits.join(' ');
}

/** Jev's reaction when fresh evidence settles its last prediction. */
export function predictionLine(hit, actual, predicted) {
  if (hit) return 'Called it. Right where I said.';
  return `Not ${zone(predicted)}. They are in ${zone(actual)}. Adjusting.`;
}

/** A guard's short acknowledgement of an order. */
export function ackLine(role) {
  return { pursue: 'On them.', intercept: 'Copy, cutting across.', block: 'Copy, holding.', guard: 'Copy, locking it down.', search: 'Copy, searching.', probe: 'Copy, checking.', investigate: 'On my way.', panel: 'Heading to the panel.', post: 'Copy.' }[role.role] || 'Copy.';
}
