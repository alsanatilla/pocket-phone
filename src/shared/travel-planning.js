// Date and booking calculations shared by the planner and its focused checks.
// ISO calendar days use UTC arithmetic, independent of browser locale or DST.
const DAY_MS = 86_400_000;
const CONFIRMED = new Set(['booked', 'included']);
const SELECTED = new Set(['chosen', 'booked', 'included']);
const clone = value => JSON.parse(JSON.stringify(value));
const list = value => Array.isArray(value) ? value : [];

function dayTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
}

export function daysBetween(from, to) {
  const start = dayTime(from), end = dayTime(to);
  return start === null || end === null ? null : Math.round((end - start) / DAY_MS);
}

export function addDays(day, count) {
  const time = dayTime(day);
  if (time === null || !Number.isSafeInteger(count)) return '';
  const date = new Date(time + count * DAY_MS);
  if (!Number.isFinite(date.getTime())) return '';
  const result = date.toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : '';
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Checkout is exclusive, so a transfer day belongs to the next stop. */
export function currentStop(trip, today = localToday()) {
  if (dayTime(today) === null) return null;
  return list(trip?.stops).find(stop => daysBetween(stop.arrival, stop.departure) > 0
    && stop.arrival <= today && today < stop.departure) || null;
}

function amount(value) {
  if (typeof value !== 'number' && typeof value !== 'string' || typeof value === 'string' && !value.trim()) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}

/** An explicit total wins. Partial or invalid stay dates never invent nights. */
export function stayTotals(stay, stop) {
  const total = amount(stay?.totalCost);
  if (total !== null) return total;
  const nightly = amount(stay?.nightlyCost);
  if (nightly === null) return null;
  let nights;
  if (stay?.checkIn || stay?.checkOut) nights = daysBetween(stay.checkIn, stay.checkOut);
  else {
    nights = daysBetween(stop?.arrival, stop?.departure);
    if (nights === null) nights = Number.isInteger(stop?.nights) && stop.nights >= 0 ? stop.nights : null;
  }
  return nights === null || nights < 0 ? null : nightly * nights;
}

/** Count the union of confirmed reservation nights, clipped to this stop. */
export function stayCoverage(stop) {
  const required = daysBetween(stop?.arrival, stop?.departure);
  const confirmed = list(stop?.stays).filter(stay => CONFIRMED.has(stay.status));
  const unknownStays = confirmed.filter(stay => {
    const nights = daysBetween(stay.checkIn, stay.checkOut);
    return nights === null || nights <= 0;
  }).length;
  if (required === null || required < 0) return {
    status: 'unknown', required: null, covered: 0, uncovered: null, overlap: 0,
    unknown: Math.max(1, unknownStays), ranges: [],
  };

  const events = new Map();
  for (const stay of confirmed) {
    const nights = daysBetween(stay.checkIn, stay.checkOut);
    if (nights === null || nights <= 0) continue;
    const start = Math.max(dayTime(stop.arrival), dayTime(stay.checkIn));
    const end = Math.min(dayTime(stop.departure), dayTime(stay.checkOut));
    if (end <= start) continue;
    events.set(start, (events.get(start) || 0) + 1);
    events.set(end, (events.get(end) || 0) - 1);
  }
  let count = 0, previous = null, covered = 0, overlap = 0;
  const intervals = [];
  for (const [time, change] of [...events].sort(([a], [b]) => a - b)) {
    if (previous !== null && count > 0 && time > previous) {
      const nights = (time - previous) / DAY_MS;
      covered += nights;
      if (count > 1) overlap += nights;
      if (intervals.length && intervals.at(-1)[1] === previous) intervals.at(-1)[1] = time;
      else intervals.push([previous, time]);
    }
    count += change; previous = time;
  }
  const uncovered = Math.max(0, required - covered);
  const status = unknownStays ? 'unknown' : overlap ? 'overlap' : !uncovered ? 'covered' : covered ? 'partial' : 'uncovered';
  return { status, required, covered, uncovered, overlap, unknown: unknownStays,
    ranges: intervals.map(([start, end]) => ({ start: new Date(start).toISOString().slice(0, 10), end: new Date(end).toISOString().slice(0, 10) })) };
}

/** Saved alternatives never enter the selected-trip total. No FX estimates. */
export function tripCosts(trip) {
  const groups = new Map();
  let unknownStays = 0, unknownConnections = 0;
  function group(currency) {
    const code = typeof currency === 'string' && currency ? currency : trip?.currency || 'EUR';
    if (!groups.has(code)) groups.set(code, { currency: code, stays: 0, bookedStays: 0, chosenStays: 0, connections: 0, total: 0, unknownStays: 0, unknownConnections: 0 });
    return groups.get(code);
  }
  function connection(value, fallback) {
    if (!value || typeof value !== 'object') return;
    const row = group(value.currency || fallback), cost = amount(value.cost);
    if (cost === null) { row.unknownConnections++; unknownConnections++; }
    else { row.connections += cost; row.total += cost; }
  }
  for (const stop of list(trip?.stops)) {
    for (const stay of list(stop.stays).filter(value => SELECTED.has(value.status))) {
      const row = group(stay.currency || stop.currency), total = stayTotals(stay, stop);
      if (total === null) { row.unknownStays++; unknownStays++; }
      else {
        row.stays += total; row.total += total;
        row[CONFIRMED.has(stay.status) ? 'bookedStays' : 'chosenStays'] += total;
      }
    }
    connection(stop.connection, stop.currency);
  }
  connection(trip?.returnJourney, trip?.currency);
  return { currencies: [...groups.values()].sort((a, b) => a.currency.localeCompare(b.currency)), unknownStays, unknownConnections };
}

function routeIssues(trip) {
  const issues = [], stops = list(trip?.stops);
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index], previous = stops[index - 1];
    if (daysBetween(stop.arrival, stop.departure) < 0) issues.push({ type: 'chronology', stopId: stop.uid, message: `${stop.place}: departure is before arrival.` });
    if (previous?.departure && stop.arrival && daysBetween(previous.departure, stop.arrival) < 0)
      issues.push({ type: 'chronology', stopId: stop.uid, message: `${stop.place}: arrival is before leaving ${previous.place}.` });
    const stopDays = daysBetween(stop.arrival, stop.departure);
    if (stopDays !== null && stopDays >= 0 && Number.isInteger(stop.nights) && stop.nights !== stopDays)
      issues.push({ type: 'nights', stopId: stop.uid, message: `${stop.place}: saved nights differ from the dates.` });
    for (const stay of list(stop.stays).filter(value => SELECTED.has(value.status))) {
      const stayDays = daysBetween(stay.checkIn, stay.checkOut);
      if (stayDays !== null && (stayDays < 0 || stop.arrival && dayTime(stop.arrival) !== null && stay.checkIn < stop.arrival
        || stop.departure && dayTime(stop.departure) !== null && stay.checkOut > stop.departure))
        issues.push({ type: 'booking', stopId: stop.uid, stayId: stay.uid, message: `${stay.name}: reservation dates do not fit ${stop.place}.` });
    }
  }
  return issues;
}

/** Reordering changes sequence only; reservations and dates remain untouched. */
export function reorderTrip(trip, stopId, toIndex) {
  const result = clone(trip), stops = list(result?.stops), from = stops.findIndex(stop => stop.uid === stopId);
  const affected = [];
  if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= stops.length || from === toIndex)
    return { trip: result, changed: false, affected, issues: [] };
  const predecessor = new Map(stops.map((stop, index) => [stop.uid, index ? stops[index - 1].uid : null]));
  const finalStop = stops.at(-1)?.uid;
  const [moved] = stops.splice(from, 1); stops.splice(toIndex, 0, moved);
  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];
    if (predecessor.get(stop.uid) !== (index ? stops[index - 1].uid : null)) {
      stop.connection = { ...(stop.connection || {}), needsReview: true }; affected.push(stop.uid);
    }
  }
  if (finalStop !== stops.at(-1)?.uid && result.returnJourney) result.returnJourney.needsReview = true;
  return { trip: result, changed: true, affected, issues: routeIssues(result) };
}

/** Removing a destination invalidates only the next incoming or homeward leg. */
export function removeStop(trip, stopId) {
  const result = clone(trip), stops = list(result?.stops), index = stops.findIndex(stop => stop.uid === stopId);
  const affected = [];
  if (index < 0) return { trip: result, changed: false, affected, issues: [] };
  const finalStop = stops.at(-1)?.uid;
  stops.splice(index, 1);
  const successor = stops[index];
  if (successor) {
    successor.connection = { ...(successor.connection || {}), needsReview: true };
    affected.push(successor.uid);
  }
  if (finalStop !== stops.at(-1)?.uid && result.returnJourney) result.returnJourney.needsReview = true;
  return { trip: result, changed: true, affected, issues: routeIssues(result) };
}
