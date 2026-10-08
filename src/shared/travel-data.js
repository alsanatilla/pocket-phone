// Shared travel document normalization and three-way reconciliation. This module
// deliberately has no browser storage or server dependencies.
const CURRENCIES = ['EUR', 'USD', 'PEN', 'BOB', 'CLP', 'BRL'];
const STOP_CURRENCY = { Peru: 'PEN', Bolivien: 'BOB', Chile: 'CLP', Brasilien: 'BRL' };
const STATUS = ['idea', 'shortlist', 'booked', 'included'];
const STAY_STATUS = ['idea', 'shortlist', 'chosen', 'booked', 'included'];
const STAY_KINDS = ['hotel', 'guesthouse', 'apartment', 'hostel', 'tour', 'camp', 'other'];
const MOMENT_KINDS = ['detour', 'taste', 'sound', 'person', 'tiny', 'weather', 'other'];
const MODES = ['flight', 'train', 'bus', 'ferry', 'transfer', 'tour', 'other'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const currency = value => CURRENCIES.includes(value) ? value : 'EUR';
const choice = (value, options, fallback = options[0]) => options.includes(value) ? value : fallback;
const amount = value => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : '';
const timestamp = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(new Date(`${value}T12:00:00Z`).getTime())
  && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
const list = (value, limit) => Array.isArray(value) ? value.slice(0, limit) : [];

function identifier() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (globalThis.crypto?.getRandomValues) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function url(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : '';
  } catch { return ''; }
}

function normalizeConnection(value, stopCurrency, arrival) {
  const current = record(value) ? value : {};
  return {
    mode: choice(current.mode, MODES, 'transfer'), label: text(current.label, 160),
    date: day(current.date) ? current.date : day(arrival) ? arrival : '',
    url: url(current.url), cost: amount(current.cost), currency: currency(current.currency || stopCurrency),
    status: choice(current.status, STATUS), reference: text(current.reference, 120), needsReview: current.needsReview === true,
  };
}

function normalizeStay(value, stopCurrency) {
  const current = record(value) ? value : {};
  return {
    uid: text(current.uid, 100) || identifier(), name: text(current.name, 140),
    kind: choice(current.kind, STAY_KINDS), url: url(current.url),
    rating: Math.max(0, Math.min(5, Math.round(Number(current.rating) || 0))), status: choice(current.status, STAY_STATUS),
    nightlyCost: amount(current.nightlyCost), totalCost: amount(current.totalCost), currency: currency(current.currency || stopCurrency),
    checkIn: day(current.checkIn) ? current.checkIn : '', checkOut: day(current.checkOut) ? current.checkOut : '',
    cancelBy: day(current.cancelBy) ? current.cancelBy : '', bookingRef: text(current.bookingRef, 120),
    address: text(current.address, 240), note: text(current.note, 800),
  };
}

function normalizeActivity(value) {
  const current = typeof value === 'string' ? { text: value } : record(value) ? value : {};
  return {
    uid: text(current.uid, 100) || identifier(), text: text(current.text, 240),
    done: Boolean(current.done), optional: Boolean(current.optional),
  };
}

function normalizeMoment(value, now) {
  const current = record(value) ? value : {};
  return {
    uid: text(current.uid, 100) || identifier(), kind: choice(current.kind, MOMENT_KINDS, 'other'),
    title: text(current.title, 240), detail: text(current.detail, 600), day: day(current.day) ? current.day : '',
    created: timestamp(current.created, now),
  };
}

function normalizeStop(value, now) {
  const current = record(value) ? value : {};
  const country = text(current.country, 80), stopCurrency = currency(current.currency || STOP_CURRENCY[country]);
  return {
    uid: text(current.uid, 100) || identifier(), place: text(current.place, 140), country,
    arrival: day(current.arrival) ? current.arrival : '', departure: day(current.departure) ? current.departure : '',
    nights: Math.max(0, Math.min(90, Math.round(Number(current.nights) || 0))), currency: stopCurrency,
    guidance: text(current.guidance, 700),
    activities: list(current.activities, 60).map(normalizeActivity).filter(item => item.text),
    stays: list(current.stays, 20).map(item => normalizeStay(item, stopCurrency)).filter(item => item.name),
    moments: list(current.moments, 100).map(item => normalizeMoment(item, now)).filter(item => item.title),
    connection: normalizeConnection(current.connection, stopCurrency, current.arrival),
  };
}

/** Tolerant local-data migration. Server validation must run separately. */
export function normalizeTrip(value) {
  if (!record(value) || !text(value.title, 100)) return null;
  const journey = record(value.returnJourney) ? value.returnJourney : {};
  const now = Date.now();
  return {
    uid: text(value.uid, 100) || identifier(), title: text(value.title, 100),
    status: choice(value.status, ['draft', 'active', 'done']),
    departure: day(value.departure) ? value.departure : '', returnDate: day(value.returnDate) ? value.returnDate : '',
    homeArrival: day(value.homeArrival) ? value.homeArrival : '', homeCity: text(value.homeCity, 100),
    countries: text(value.countries, 180), travelers: text(value.travelers, 160), currency: currency(value.currency),
    budget: amount(value.budget), intention: text(value.intention, 900), returnPlan: text(value.returnPlan, 900),
    returnJourney: {
      label: text(journey.label, 240), date: day(journey.date) ? journey.date : day(value.returnDate) ? value.returnDate : '',
      url: url(journey.url), cost: amount(journey.cost), currency: currency(journey.currency || 'BRL'),
      status: choice(journey.status, STATUS), reference: text(journey.reference, 120), needsReview: journey.needsReview === true,
    },
    stops: list(value.stops, 80).map(item => normalizeStop(item, now)).filter(item => item.place),
    moments: list(value.moments, 100).map(item => normalizeMoment(item, now)).filter(item => item.title),
    created: timestamp(value.created, now), updated: timestamp(value.updated, now),
  };
}

/** JSON serialization whose object-key order is independent of insertion order. */
export function canonical(value) {
  return JSON.stringify(value, (_key, current) => record(current)
    ? Object.fromEntries(Object.keys(current).sort().map(key => [key, current[key]])) : current);
}

const MISSING = Symbol('missing');
const equal = (left, right) => left === MISSING || right === MISSING ? left === right : canonical(left) === canonical(right);
const clone = value => Array.isArray(value) ? value.map(clone) : record(value)
  ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
const member = (value, key) => value !== MISSING && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : MISSING;
const keyed = value => Array.isArray(value) && value.every(item => record(item) && typeof item.uid === 'string' && item.uid)
  && new Set(value.map(item => item.uid)).size === value.length;
const fieldPath = (path, key) => path ? `${path}.${key}` : key;

/**
 * Merge individual fields and UID collections. Conflicting values retain the
 * local choice, with paths returned for an explicit client resolution step.
 * Null at the root means a missing/deleted trip.
 */
export function mergeTrip(base, local, remote) {
  const conflicts = new Set();
  const conflict = path => conflicts.add(path || 'trip');

  function merge(baseValue, localValue, remoteValue, path, key = '') {
    // Before route review existed, an absent flag meant no review was needed.
    // Treat that old representation as false so an older queued edit does not
    // conflict merely because the other copy now carries the explicit default.
    if (key === 'needsReview') {
      if (baseValue === MISSING) baseValue = false;
      if (localValue === MISSING) localValue = false;
      if (remoteValue === MISSING) remoteValue = false;
    }
    // Editing a timestamp does not compete with editing travel content.
    if (key === 'updated') {
      const times = [baseValue, localValue, remoteValue].filter(value => typeof value === 'number' && Number.isFinite(value));
      if (times.length) return Math.max(...times);
    }
    if (key === 'created') {
      if (baseValue !== MISSING) return clone(baseValue);
      const times = [localValue, remoteValue].filter(value => typeof value === 'number' && Number.isFinite(value));
      if (times.length) return Math.min(...times);
    }

    if (record(localValue) && record(remoteValue) && (baseValue === MISSING || record(baseValue))) {
      const keys = new Set([...Object.keys(baseValue === MISSING ? {} : baseValue), ...Object.keys(localValue), ...Object.keys(remoteValue)]);
      const entries = [];
      for (const childKey of keys) {
        const child = merge(member(baseValue, childKey), member(localValue, childKey), member(remoteValue, childKey), fieldPath(path, childKey), childKey);
        if (child !== MISSING) entries.push([childKey, child]);
      }
      return Object.fromEntries(entries);
    }

    if (keyed(localValue) && keyed(remoteValue) && (baseValue === MISSING || keyed(baseValue))) {
      return mergeCollection(baseValue === MISSING ? [] : baseValue, localValue, remoteValue, path);
    }
    if (equal(localValue, remoteValue)) return clone(localValue);
    if (equal(baseValue, localValue)) return clone(remoteValue);
    if (equal(baseValue, remoteValue)) return clone(localValue);
    conflict(path);
    return clone(localValue);
  }

  function mergeCollection(baseItems, localItems, remoteItems, path) {
    const baseMap = new Map(baseItems.map(item => [item.uid, item]));
    const localMap = new Map(localItems.map(item => [item.uid, item]));
    const remoteMap = new Map(remoteItems.map(item => [item.uid, item]));
    const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
    const merged = new Map();
    for (const uid of ids) {
      const value = merge(baseMap.get(uid) ?? MISSING, localMap.get(uid) ?? MISSING, remoteMap.get(uid) ?? MISSING, `${path}[${uid}]`);
      if (value !== MISSING) merged.set(uid, value);
    }
    return mergeOrder(baseItems, localItems, remoteItems, merged, path).map(uid => merged.get(uid));
  }

  function mergeOrder(baseItems, localItems, remoteItems, merged, path) {
    const positions = items => new Map(items.filter(item => merged.has(item.uid)).map((item, index) => [item.uid, index]));
    const basePositions = positions(baseItems), localPositions = positions(localItems), remotePositions = positions(remoteItems);
    const preference = [...new Set([...localPositions.keys(), ...remotePositions.keys(), ...basePositions.keys()])];
    const outgoing = new Map(preference.map(uid => [uid, new Set()]));
    const incoming = new Map(preference.map(uid => [uid, 0]));
    const before = (map, left, right) => map.has(left) && map.has(right) ? map.get(left) < map.get(right) : undefined;
    for (let leftIndex = 0; leftIndex < preference.length; leftIndex++) {
      for (let rightIndex = leftIndex + 1; rightIndex < preference.length; rightIndex++) {
        const left = preference[leftIndex], right = preference[rightIndex];
        const old = before(basePositions, left, right), ours = before(localPositions, left, right), theirs = before(remotePositions, left, right);
        let selected;
        if (ours === undefined) selected = theirs;
        else if (theirs === undefined || ours === theirs) selected = ours;
        else if (old !== undefined && ours === old) selected = theirs;
        else if (old !== undefined && theirs === old) selected = ours;
        else { conflict(fieldPath(path, 'order')); selected = ours; }
        if (selected === undefined) continue;
        const first = selected ? left : right, second = selected ? right : left;
        outgoing.get(first).add(second);
        incoming.set(second, incoming.get(second) + 1);
      }
    }

    const remaining = new Set(preference), result = [];
    while (remaining.size) {
      let next = preference.find(uid => remaining.has(uid) && incoming.get(uid) === 0);
      if (next === undefined) {
        // Individually valid moves can create a combined cycle. Keep every
        // entity and use local order to break it while exposing the conflict.
        conflict(fieldPath(path, 'order'));
        next = preference.find(uid => remaining.has(uid));
      }
      remaining.delete(next);
      result.push(next);
      for (const successor of outgoing.get(next)) incoming.set(successor, incoming.get(successor) - 1);
    }
    return result;
  }

  const value = merge(base == null ? MISSING : base, local == null ? MISSING : local, remote == null ? MISSING : remote, '');
  return { value: value === MISSING ? null : value, conflicts: [...conflicts].sort() };
}
