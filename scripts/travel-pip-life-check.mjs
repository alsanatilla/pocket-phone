// Run: node scripts/travel-pip-life-check.mjs
// Pure Pip rules only: daily rhythm, bubble facts, visited stops and souvenirs. No DOM, DB, or network.
import assert from 'node:assert/strict';
import { localToday, pipPhase, stopFacts, visitedStops, souvenirFor } from '../src/client/pip-travel-life.js';

const at = (hour, minute = 0) => Date.UTC(2026, 0, 15, hour, minute);
const stop = (uid, extra = {}) => ({ uid, place: uid, country: 'Portugal', arrival: '2026-02-07', departure: '2026-02-09', nights: 2, stays: [], activities: [], connection: {}, ...extra });
const trip = (stops, extra = {}) => ({ uid: 'trip', homeCity: 'Berlin', stops, ...extra });

// Phase boundaries at Greenwich (lng 0), in UTC.
assert.equal(pipPhase(0, at(5, 59)), 'night');
assert.equal(pipPhase(0, at(6, 0)), 'morning');
assert.equal(pipPhase(0, at(10, 59)), 'morning');
assert.equal(pipPhase(0, at(11, 0)), 'day');
assert.equal(pipPhase(0, at(17, 59)), 'day');
assert.equal(pipPhase(0, at(18, 0)), 'evening');
assert.equal(pipPhase(0, at(21, 59)), 'evening');
assert.equal(pipPhase(0, at(22, 0)), 'night');
// Longitude 80 is 5h20m ahead: 00:40 UTC is 06:00 local solar time.
assert.equal(pipPhase(80, Date.UTC(2026, 0, 15, 0, 39)), 'night');
assert.equal(pipPhase(80, Date.UTC(2026, 0, 15, 0, 40)), 'morning');
// Negative longitudes wrap the same way.
assert.equal(pipPhase(-120, Date.UTC(2026, 0, 15, 6, 0)), 'night');
assert.equal(pipPhase(-120, Date.UTC(2026, 0, 15, 14, 0)), 'morning');
console.log('PASS daily rhythm boundaries and longitude shift');

// Bubble facts for a booked stop with a next stop and some ideas.
const lisbon = stop('Lisbon', {
  stays: [{ uid: 's1', name: 'Casa Azul', status: 'chosen' }, { uid: 's2', name: 'Pensão', status: 'booked' }],
  activities: [{ done: true }, { done: false }, { done: false }],
});
const porto = stop('Porto', { arrival: '2026-02-09', departure: '2026-02-10', nights: 1, connection: { mode: 'train', status: 'booked' } });
const berlin = stop('Berlin-trip-end', { arrival: '', departure: '', nights: 0 });
const route = trip([lisbon, porto, berlin]);
assert.deepEqual(stopFacts(route, 'Lisbon', '2026-02-01', 'en-GB'), [
  'Lisbon · 2 nights · 7 Feb – 9 Feb',
  'booked · Pensão',
  'next · Porto · train · booked',
  '1 of 3 ideas done',
]);
assert.deepEqual(stopFacts(route, 'Porto', '2026-02-01', 'en-GB'), [
  'Porto · 1 night · 9 Feb – 10 Feb',
  'no stay yet',
  'next · Berlin-trip-end · connection needed',
]);
// Last stop: no next stop, and the trip ends at home.
assert.deepEqual(stopFacts(route, 'Berlin-trip-end', '2026-02-01', 'en-GB'), [
  'Berlin-trip-end · dates open',
  'no stay yet',
  'last stop · then Berlin',
]);
// A chosen stay is shown when nothing is booked; several unbooked stays are counted.
assert.equal(stopFacts(trip([stop('A', { stays: [{ uid: 'x', name: 'Hotel', status: 'chosen' }] })]), 'A', '2026-02-01', 'en-GB')[1], 'chosen · Hotel');
assert.equal(stopFacts(trip([stop('A', { stays: [{ uid: 'x', status: 'shortlist' }, { uid: 'y', status: 'idea' }] })]), 'A', '2026-02-01', 'en-GB')[1], '2 stays saved · none booked');
assert.equal(stopFacts(trip([stop('A', { stays: [{ uid: 'x', status: 'idea' }] })]), 'A', '2026-02-01', 'en-GB')[1], '1 stay saved · none booked');
// Missing stop gives no facts; the bubble then has nothing to show.
assert.deepEqual(stopFacts(route, 'nowhere', '2026-02-01', 'en-GB'), []);
// Arrival plus nights gives the last day when there is no departure.
assert.equal(stopFacts(trip([stop('A', { departure: '', arrival: '2026-02-07', nights: 2 })]), 'A', '2026-02-01', 'en-GB')[0], 'A · 2 nights · 7 Feb – 9 Feb');
console.log('PASS bubble facts for booked, unbooked, last and single-night stops');

// Visited stops: departure before today, arrival plus nights, never today, never undated.
const past = stop('past', { arrival: '2026-01-01', departure: '2026-01-04', nights: 3 });
const today = stop('today', { arrival: '2026-02-01', departure: '2026-02-03', nights: 2 });
const future = stop('future', { arrival: '2026-03-01', departure: '2026-03-03', nights: 2 });
const undated = stop('undated', { arrival: '', departure: '', nights: 2 });
const nightsOnly = stop('nights-only', { arrival: '2026-01-20', departure: '', nights: 3 });
const log = trip([past, today, future, undated, nightsOnly]);
assert.deepEqual(visitedStops(log, '2026-02-03').map(item => item.uid), ['past', 'nights-only']);
assert.deepEqual(visitedStops(log, '2026-02-04').map(item => item.uid), ['past', 'today', 'nights-only']);
assert.deepEqual(visitedStops(log, '2026-01-23').map(item => item.uid), ['past']);
assert.deepEqual(visitedStops({}, '2026-02-04'), []);
assert.ok(stopFacts(log, 'past', '2026-02-04').includes('souvenir · from past'));
assert.ok(!stopFacts(log, 'future', '2026-02-04').some(fact => fact.startsWith('souvenir')));
console.log('PASS visited stops use the local calendar date and skip undated stops');

// Souvenirs: same uid, same glyph and colour; many uids spread across the set.
const first = souvenirFor({ uid: 'stop-a' }), again = souvenirFor({ uid: 'stop-a' });
assert.deepEqual(first, again);
const glyphs = new Set(), colors = new Set();
for (let i = 0; i < 80; i++) { const item = souvenirFor({ uid: `uid-${i}` }); glyphs.add(item.glyph); colors.add(item.color); }
assert.equal(glyphs.size, 8, 'Every glyph is reachable.');
assert.equal(colors.size, 4, 'Every colour is reachable.');
for (let i = 0; i < 80; i++) {
  const { svg } = souvenirFor({ uid: `uid-${i}` });
  assert.match(svg, /^<svg viewBox="0 0 12 12" width="16" height="16" fill="currentColor" shape-rendering="crispEdges"/);
  const body = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
  assert.ok(/^(<rect x="\d+" y="\d+" width="\d+" height="1"\/>)+$/.test(body), 'Only rect pixels inside the svg.');
}
console.log('PASS souvenirs are deterministic and draw only rect pixels');

// Local calendar date, not UTC.
assert.equal(localToday(new Date(2026, 1, 3, 0, 30)), '2026-02-03');
assert.equal(localToday(new Date(2026, 11, 31, 23, 59)), '2026-12-31');
console.log('PASS local today');
