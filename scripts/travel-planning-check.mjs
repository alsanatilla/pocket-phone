// Run: node scripts/travel-planning-check.mjs
// Pure calculations and server payload validation only. No .env, DB, or network.
import assert from 'node:assert/strict';
import { daysBetween, addDays, currentStop, stayTotals, stayCoverage, tripCosts, reorderTrip, removeStop } from '../src/shared/travel-planning.js';
import { normalizeTrip, mergeTrip, canonical } from '../src/shared/travel-data.js';
import { validateTravelTrip } from '../src/server/travel.js';

const copy = value => JSON.parse(JSON.stringify(value));
const stay = (uid, checkIn, checkOut, extra = {}) => ({ uid, name: uid, status: 'booked', checkIn, checkOut, ...extra });
const stop = (uid = 'lima', extra = {}) => ({ uid, place: uid, country: 'Peru', arrival: '2028-01-01', departure: '2028-01-06', nights: 5, currency: 'EUR', stays: [], connection: { cost: '', currency: 'EUR' }, ...extra });
const trip = (stops = [stop()], extra = {}) => normalizeTrip({ uid: 'fixture-trip', title: 'Fixture', homeCity: 'Home', currency: 'EUR', created: 100, updated: 100, stops, ...extra });

assert.equal(daysBetween('2028-02-28', '2028-03-01'), 2);
assert.equal(daysBetween('2027-02-28', '2027-03-01'), 1);
assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2, 'DST changes cannot change calendar nights.');
assert.equal(daysBetween('2028-01-06', '2028-01-01'), -5);
assert.equal(daysBetween('2027-02-29', '2027-03-01'), null);
assert.equal(daysBetween('', '2028-01-01'), null);
assert.equal(addDays('2028-02-28', 2), '2028-03-01');
assert.equal(addDays('2028-01-01', -1), '2027-12-31');
assert.equal(addDays('not-a-date', 1), '');
assert.equal(addDays('2028-01-01', 1.5), '');
const todayTrip = { stops: [stop('first', { departure: '2028-01-03' }), stop('second', { arrival: '2028-01-03' })] };
assert.equal(currentStop(todayTrip, '2028-01-02')?.uid, 'first');
assert.equal(currentStop(todayTrip, '2028-01-03')?.uid, 'second');
assert.equal(currentStop(todayTrip, '2028-01-06'), null);
assert.equal(currentStop(todayTrip, '2027-12-31'), null);
assert.equal(currentStop({ stops: [stop('undated', { arrival: '', departure: '' })] }, '2028-01-03'), null);
console.log('PASS calendar arithmetic, leap days, invalid dates, during-trip boundaries');

const priced = stay('own-dates', '2028-01-02', '2028-01-04', { nightlyCost: 50, totalCost: '' });
assert.equal(stayTotals(priced, stop()), 100, 'Use reservation nights, not all stop nights.');
assert.equal(stayTotals({ ...priced, totalCost: 0 }, stop()), 0, 'Zero is a known total.');
assert.equal(stayTotals({ ...priced, totalCost: 75 }, stop()), 75);
assert.equal(stayTotals({ ...priced, checkOut: '' }, stop()), null, 'Partial reservation dates do not fall back.');
assert.equal(stayTotals({ ...priced, checkIn: '', checkOut: '' }, stop()), 250);
assert.equal(stayTotals({ ...priced, checkIn: '', checkOut: '' }, stop('nights', { arrival: '', departure: '', nights: 3 })), 150);
assert.equal(stayTotals({ nightlyCost: 0 }, { nights: 2 }), 0);
assert.equal(stayTotals({ nightlyCost: '' }, stop()), null);
assert.equal(stayTotals({ nightlyCost: true }, stop()), null);
assert.equal(stayTotals({ nightlyCost: 50, checkIn: '2028-01-06', checkOut: '2028-01-01' }, stop()), null);
assert.equal(stayTotals({ nightlyCost: 50 }, {}), null);
console.log('PASS reservation-specific totals, explicit zero, missing prices and dates');

const empty = stayCoverage(stop());
assert.deepEqual([empty.status, empty.required, empty.covered, empty.uncovered], ['uncovered', 5, 0, 5]);
const partial = stayCoverage(stop('partial', { stays: [stay('hotel', '2028-01-01', '2028-01-03')] }));
assert.deepEqual([partial.status, partial.covered, partial.uncovered], ['partial', 2, 3]);
const complete = stayCoverage(stop('complete', { stays: [stay('first', '2028-01-01', '2028-01-03'), stay('second', '2028-01-03', '2028-01-06', { status: 'included' })] }));
assert.deepEqual([complete.status, complete.covered, complete.uncovered, complete.overlap], ['covered', 5, 0, 0]);
assert.deepEqual(complete.ranges, [{ start: '2028-01-01', end: '2028-01-06' }]);
const overlapping = stayCoverage(stop('overlap', { stays: [stay('first', '2028-01-01', '2028-01-04'), stay('second', '2028-01-03', '2028-01-05')] }));
assert.deepEqual([overlapping.status, overlapping.covered, overlapping.uncovered, overlapping.overlap], ['overlap', 4, 1, 1]);
const clipped = stayCoverage(stop('clipped', { stays: [stay('hotel', '2027-12-29', '2028-01-02')] }));
assert.deepEqual([clipped.covered, clipped.uncovered], [1, 4]);
const alternatives = stayCoverage(stop('options', { stays: [stay('option', '2028-01-01', '2028-01-06', { status: 'chosen' }), stay('shortlist', '2028-01-01', '2028-01-06', { status: 'shortlist' })] }));
assert.equal(alternatives.status, 'uncovered');
const unknown = stayCoverage(stop('unknown', { stays: [stay('undated', '', '')] }));
assert.deepEqual([unknown.status, unknown.unknown, unknown.covered], ['unknown', 1, 0]);
const undatedStop = stayCoverage(stop('undated-stop', { arrival: '', departure: '', stays: [stay('hotel', '2028-01-01', '2028-01-06')] }));
assert.deepEqual([undatedStop.status, undatedStop.required, undatedStop.uncovered], ['unknown', null, null]);
assert.equal(stayCoverage(stop('day-stop', { departure: '2028-01-01', nights: 0 })).status, 'covered');
assert.equal(stayCoverage(stop('invalid', { stays: [stay('hotel', '2027-02-29', '2028-01-06')] })).status, 'unknown');
console.log('PASS exact confirmed-night union, partial coverage, clipping, overlaps and unknown reservations');

const costs = tripCosts(trip([
  stop('first', { connection: { cost: 10, currency: 'EUR' }, stays: [
    priced,
    stay('chosen', '', '', { status: 'chosen', totalCost: 80 }),
    stay('shortlist', '', '', { status: 'shortlist', totalCost: 999 }),
    stay('idea', '', '', { status: 'idea', totalCost: 666 }),
    stay('included', '', '', { status: 'included', totalCost: 0 }),
    stay('missing', '', '', { status: 'chosen' }),
  ] }),
  stop('second', { currency: 'PEN', connection: { cost: 30, currency: 'PEN' } }),
], { returnJourney: { label: 'Return', cost: '', currency: 'EUR' } }));
assert.deepEqual(costs.currencies, [
  { currency: 'EUR', stays: 180, bookedStays: 100, chosenStays: 80, connections: 10, total: 190, unknownStays: 1, unknownConnections: 1 },
  { currency: 'PEN', stays: 0, bookedStays: 0, chosenStays: 0, connections: 30, total: 30, unknownStays: 0, unknownConnections: 0 },
]);
assert.deepEqual([costs.unknownStays, costs.unknownConnections], [1, 1]);
console.log('PASS chosen/confirmed costs, excluded alternatives, separate currencies and unknown counts');

const original = trip([
  stop('a', { arrival: '2028-01-01', departure: '2028-01-03', nights: 2 }),
  stop('b', { arrival: '2028-01-03', departure: '2028-01-05', nights: 2, stays: [stay('booked-b', '2028-01-03', '2028-01-05', { bookingRef: 'KEPT' })] }),
  stop('c', { arrival: '2028-01-05', departure: '2028-01-07', nights: 2 }),
  stop('d', { arrival: '2028-01-07', departure: '2028-01-09', nights: 2 }),
], { returnJourney: { label: 'Flight home', date: '2028-01-09', reference: 'RETURN' } });
const before = canonical(original), reordered = reorderTrip(original, 'b', 2);
assert.equal(reordered.changed, true);
assert.deepEqual(reordered.trip.stops.map(value => value.uid), ['a', 'c', 'b', 'd']);
assert.deepEqual(reordered.affected, ['c', 'b', 'd']);
assert.equal(reordered.trip.stops[0].connection.needsReview, false);
assert.equal(reordered.trip.returnJourney.needsReview, false);
assert.equal(reordered.issues.some(issue => issue.type === 'chronology' && issue.stopId === 'b'), true);
for (const old of original.stops) {
  const current = reordered.trip.stops.find(value => value.uid === old.uid);
  assert.deepEqual([current.arrival, current.departure, current.nights, current.stays], [old.arrival, old.departure, old.nights, old.stays]);
}
assert.equal(canonical(original), before, 'Reordering cannot mutate its input.');
const movedFinal = reorderTrip(original, 'b', 3);
assert.equal(movedFinal.trip.returnJourney.needsReview, true);
assert.equal(movedFinal.trip.returnJourney.reference, 'RETURN');
assert.equal(reorderTrip(original, 'missing', 0).changed, false);
assert.equal(reorderTrip(original, 'b', 1).changed, false);
assert.equal(reorderTrip(original, 'b', 100).changed, false);
const mismatchTrip = copy(original);
mismatchTrip.stops[1].stays[0].checkOut = '2028-01-08';
const mismatch = reorderTrip(mismatchTrip, 'b', 2);
assert.equal(mismatch.issues.some(issue => issue.type === 'booking' && issue.stayId === 'booked-b'), true);
const nightsTrip = copy(original); nightsTrip.stops[1].nights = 8;
assert.equal(reorderTrip(nightsTrip, 'b', 2).issues.some(issue => issue.type === 'nights' && issue.stopId === 'b'), true);
console.log('PASS reorder preservation, affected connections/return leg and chronological/booking issues');

for (const [removedId, remaining, affected, returnReview] of [
  ['a', ['b', 'c', 'd'], ['b'], false],
  ['b', ['a', 'c', 'd'], ['c'], false],
  ['d', ['a', 'b', 'c'], [], true],
]) {
  const removed = removeStop(original, removedId);
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.trip.stops.map(value => value.uid), remaining);
  assert.deepEqual(removed.affected, affected);
  assert.equal(removed.trip.returnJourney.needsReview, returnReview);
  assert.equal(removed.trip.returnJourney.reference, 'RETURN');
  for (const current of removed.trip.stops) {
    const old = original.stops.find(value => value.uid === current.uid);
    assert.deepEqual([current.arrival, current.departure, current.nights, current.stays], [old.arrival, old.departure, old.nights, old.stays]);
    assert.equal(current.connection.needsReview, affected.includes(current.uid));
  }
  assert.equal(canonical(original), before);
}
const onlyStop = trip([stop('only')], { returnJourney: { label: 'Home', reference: 'KEEP' } });
assert.deepEqual(removeStop(onlyStop, 'only').trip.stops, []);
assert.equal(removeStop(onlyStop, 'only').trip.returnJourney.needsReview, true);
const unknownRemoval = removeStop(original, 'unknown');
assert.equal(unknownRemoval.changed, false);
assert.equal(canonical(unknownRemoval.trip), before);
assert.deepEqual(unknownRemoval.affected, []);
console.log('PASS remove first/middle/final/only stop, review flags and retained reservations');

const schema = trip([stop('chosen-schema', { stays: [stay('selection', '2028-01-01', '2028-01-06', { status: 'chosen' })], connection: { needsReview: true } })], { returnJourney: { needsReview: true } });
assert.equal(validateTravelTrip(schema).stops[0].stays[0].status, 'chosen');
assert.equal(validateTravelTrip(schema).stops[0].connection.needsReview, true);
assert.equal(validateTravelTrip(schema).returnJourney.needsReview, true);
const oldPayload = copy(original);
for (const value of oldPayload.stops) delete value.connection.needsReview;
delete oldPayload.returnJourney.needsReview;
assert.equal(validateTravelTrip(oldPayload).stops[0].connection.needsReview, false);
assert.equal(validateTravelTrip(oldPayload).returnJourney.needsReview, false);
for (const path of ['arrival', 'return']) {
  const invalid = copy(schema);
  (path === 'arrival' ? invalid.stops[0].connection : invalid.returnJourney).needsReview = 'yes';
  assert.throws(() => validateTravelTrip(invalid), error => error.status === 400);
}
const invalidConnection = copy(schema); invalidConnection.stops[0].connection.status = 'chosen';
assert.throws(() => validateTravelTrip(invalidConnection), error => error.status === 400, 'Chosen is accommodation-only.');
const local = validateTravelTrip({ ...oldPayload, title: 'Older queued title edit' });
const remote = copy(oldPayload); remote.stops[0].connection.needsReview = true;
const merged = mergeTrip(oldPayload, local, remote);
assert.deepEqual(merged.conflicts, [], 'A new false default cannot make an old queued edit conflict.');
assert.equal(merged.value.title, 'Older queued title edit');
assert.equal(merged.value.stops[0].connection.needsReview, true);
const reverse = mergeTrip(oldPayload, { ...copy(oldPayload), title: 'Old client title' }, validateTravelTrip(remote));
assert.deepEqual(reverse.conflicts, []);
assert.equal(reverse.value.stops[0].connection.needsReview, true);
console.log('PASS strict server schema, old payloads, new defaults and old pending merge compatibility');
console.log('Travel planning checks passed without network or database access.');
