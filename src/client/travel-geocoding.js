import { loadGoogleMaps, onMapsAuthFailure } from './google-maps.js';
import { activeAccount, storage } from './workspace-storage.js';

// Google geometry is temporary and may only be displayed on a Google map.
// Trip documents retain a user-confirmed placeId/query, never returned geometry
// or Google's formatted addresses. Cached coordinates expire within 30 days.
const CACHE = 'pocket:travel-google-geocoding-v1', MAX_CACHE = 200, MAX_QUEUE = 200, MAX_ACTIVE = 3;
const MAX_AGE = 30 * 86400000, FAILURE_AGE = 30000, GEOCODE_TIMEOUT = 12000;
const jobs = new Map(), queue = [], failures = new Map();
let active = 0, generation = 0, cooldown = 0, geocoder = null, geocoderMaps = null;
const clean = value => typeof value === 'string' ? value.normalize('NFC').trim().replace(/\s+/g, ' ') : '';
const folded = value => clean(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const abortError = () => new DOMException('Location lookup stopped.', 'AbortError');
const unavailable = () => ({ status: 'unavailable', error: 'Location lookup is unavailable. Try again later.' });
const interrupted = () => ({ status: 'unavailable', error: 'Location lookup was interrupted.' });
const clone = value => structuredClone(value);
export const locationQuery = subject => {
  const place = clean(subject?.place), country = clean(subject?.country);
  return place ? place + (country ? ', ' + country : '') : '';
};
function confirmedId(subject, query) {
  const location = subject?.location;
  return location && clean(location.query) === query && typeof location.placeId === 'string' && /^[A-Za-z0-9_-]{1,300}$/.test(location.placeId) ? location.placeId : '';
}

const COUNTRY_CODES = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
let countryNames;
function countryCode(value) {
  const name = folded(value); if (!name) return '';
  if (!countryNames) {
    countryNames = new Map(COUNTRY_CODES.map(code => [code.toLowerCase(), code]));
    for (const [alias, code] of [['uk', 'GB'], ['usa', 'US'], ['united states of america', 'US'], ['south korea', 'KR'], ['bolivia', 'BO'], ['bolivien', 'BO'], ['brasilien', 'BR'], ['peru', 'PE']]) countryNames.set(alias, code);
    for (const locale of new Set(['en', 'de', 'es', 'fr', 'it', 'pt', ...(globalThis.navigator?.languages || [])])) {
      try { const names = new Intl.DisplayNames([locale], { type: 'region' }); for (const code of COUNTRY_CODES) countryNames.set(folded(names.of(code)), code); } catch { /* Literal country names remain usable without Intl support. */ }
    }
  }
  return countryNames.get(name) || '';
}
function countryMatches(result, saved) {
  if (!clean(saved)) return false;
  const component = result.address_components?.find(item => item.types?.includes('country'));
  if (!component) return false;
  const code = countryCode(saved);
  return code ? String(component.short_name).toUpperCase() === code : [component.long_name, component.short_name].some(name => folded(name) === folded(saved));
}
function coordinate(value) {
  if (!value || typeof value.placeId !== 'string' || !/^[A-Za-z0-9_-]{1,300}$/.test(value.placeId)) return null;
  const lat = value.lat, lng = value.lng;
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 && Number.isFinite(lng) && lng >= -180 && lng <= 180
    ? { lat, lng, placeId: value.placeId, approximate: value.approximate === true } : null;
}
function entries() {
  try {
    const saved = JSON.parse(storage.getItem(CACHE) || 'null');
    if (saved?.version !== 1 || !Array.isArray(saved.entries)) return [];
    return saved.entries.slice(-MAX_CACHE).flatMap(item => {
      const location = coordinate(item);
      return location && typeof item.key === 'string' && item.key.length <= 1400 && Number.isFinite(item.created) && item.created <= Date.now() && Date.now() - item.created < MAX_AGE
        ? [{ key: item.key, ...location, created: item.created, used: Number.isFinite(item.used) ? item.used : item.created }] : [];
    });
  } catch { return []; }
}
function saveEntries(values) {
  try { storage.setItem(CACHE, JSON.stringify({ version: 1, entries: values.sort((a, b) => a.used - b.used).slice(-MAX_CACHE) })); } catch { /* Lookup remains available when browser storage is full. */ }
}
function fromCache(key) {
  const values = entries(), item = values.find(entry => entry.key === key);
  if (item) { item.used = Date.now(); saveEntries(values); return coordinate(item); }
  saveEntries(values); return null;
}
function cache(key, location) {
  const values = entries().filter(item => item.key !== key);
  values.push({ key, ...location, created: Date.now(), used: Date.now() }); saveEntries(values);
}
function candidate(result) {
  try {
    const location = result.geometry?.location;
    const value = coordinate({
      lat: typeof location?.lat === 'function' ? location.lat() : location?.lat,
      lng: typeof location?.lng === 'function' ? location.lng() : location?.lng,
      placeId: result.place_id, approximate: result.partial_match === true || result.geometry?.location_type !== 'ROOFTOP',
    });
    return value ? { ...value, address: clean(result.formatted_address).slice(0, 500) } : null;
  } catch { return null; }
}
function interpret(results, job) {
  const known = [], seen = new Set();
  for (const result of Array.isArray(results) ? results : []) {
    const location = candidate(result);
    if (!location || seen.has(location.placeId)) continue;
    seen.add(location.placeId); known.push({ result, location });
  }
  if (!known.length) return { status: 'unresolved', error: 'No matching location was found.' };
  const matching = known.filter(item => countryMatches(item.result, job.country));
  if (job.placeId) {
    const exact = (clean(job.country) ? matching : known).find(item => item.location.placeId === job.placeId);
    if (exact) { const { address, ...location } = exact.location; return { status: 'resolved', location }; }
  }
  if (clean(job.country) && !matching.length) return { status: 'unresolved', error: 'No matching location was found in the saved country.' };
  if (!job.placeId && known.length === 1 && matching.length === 1 && matching[0].result.partial_match !== true) {
    const { address, ...location } = matching[0].location; return { status: 'resolved', location };
  }
  // Multiple/partial/country-uncertain matches always need a visible choice.
  return { status: 'ambiguous', candidates: (matching.length ? matching : known).slice(0, 8).map(item => item.location), error: 'Choose the matching location.' };
}
function stillCurrent(waiter, job) {
  return activeAccount() === job.account && locationQuery(waiter.subject) === job.query && confirmedId(waiter.subject, job.query) === job.placeId;
}
function finish(job, result) {
  if (job.done) return; job.done = true;
  const current = job.generation === generation && activeAccount() === job.account;
  const viable = [...job.waiters].some(waiter => !waiter.signal?.aborted && stillCurrent(waiter, job));
  if (current && viable) {
    if (result.status === 'resolved') cache(job.cacheKey, result.location);
    else { failures.set(job.key, { until: Date.now() + FAILURE_AGE, result }); while (failures.size > MAX_CACHE) failures.delete(failures.keys().next().value); }
  }
  for (const waiter of job.waiters) {
    waiter.signal?.removeEventListener('abort', waiter.abort);
    if (!waiter.signal?.aborted) waiter.resolve(current && stillCurrent(waiter, job) ? clone(result) : interrupted());
  }
  job.waiters.clear(); if (jobs.get(job.key) === job) jobs.delete(job.key);
}
async function run(job) {
  try {
    if (job.done || job.generation !== generation || activeAccount() !== job.account) { finish(job, interrupted()); return; }
    if (Date.now() < cooldown || globalThis.navigator?.onLine === false) { finish(job, unavailable()); return; }
    const maps = await loadGoogleMaps();
    if (job.done || job.generation !== generation || activeAccount() !== job.account) { finish(job, interrupted()); return; }
    if (geocoderMaps !== maps) { geocoder = new maps.Geocoder(); geocoderMaps = maps; }
    const request = job.placeId ? { placeId: job.placeId } : { address: job.query, ...(countryCode(job.country) ? { componentRestrictions: { country: countryCode(job.country) } } : {}) };
    const reply = await new Promise(resolve => {
      let completed = false;
      const complete = value => { if (!completed) { completed = true; clearTimeout(timer); resolve(value); } };
      const timer = setTimeout(() => complete(unavailable()), GEOCODE_TIMEOUT);
      try {
        geocoder.geocode(request, (results, status) => {
          if (status === 'OK') complete(interpret(results, job));
          else if (status === 'ZERO_RESULTS') complete({ status: 'unresolved', error: 'No matching location was found.' });
          else {
            if (['OVER_QUERY_LIMIT', 'REQUEST_DENIED'].includes(status)) cooldown = Date.now() + 60000;
            complete(unavailable());
          }
        });
      } catch { complete(unavailable()); }
    });
    finish(job, reply);
  } catch { finish(job, unavailable()); }
  finally { active--; pump(); }
}
function pump() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift(); if (job.done || !job.waiters.size) continue;
    active++; void run(job);
  }
}

/** Results are map-only; this function never edits a trip or chooses for the user. */
export function resolveLocation(subject, { signal, refresh = false } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  const query = locationQuery(subject), country = clean(subject?.country), account = activeAccount(), placeId = confirmedId(subject, query);
  if (!query || query.length > 1000) return Promise.resolve({ status: 'unresolved', error: 'Add a destination or address first.' });
  const cacheKey = query + '\n' + placeId, key = account + '\n' + cacheKey;
  const fast = result => Promise.resolve().then(() => {
    if (signal?.aborted) throw abortError();
    return activeAccount() === account && locationQuery(subject) === query && confirmedId(subject, query) === placeId ? clone(result) : interrupted();
  });
  const saved = fromCache(cacheKey);
  if (saved) return fast({ status: 'resolved', location: saved });
  if (refresh) failures.delete(key);
  const failed = failures.get(key);
  if (failed?.until > Date.now()) return fast(failed.result);
  failures.delete(key);
  let job = jobs.get(key);
  if (!job) {
    if (jobs.size >= MAX_QUEUE) return Promise.resolve(unavailable());
    job = { key, cacheKey, query, country, account, placeId, generation, waiters: new Set(), done: false };
    jobs.set(key, job); queue.push(job);
  }
  const result = new Promise((resolve, reject) => {
    const waiter = { subject, signal, resolve, reject, abort: null };
    waiter.abort = () => {
      job.waiters.delete(waiter); reject(abortError());
      if (!job.waiters.size) { job.done = true; if (jobs.get(job.key) === job) jobs.delete(job.key); }
    };
    job.waiters.add(waiter); signal?.addEventListener('abort', waiter.abort, { once: true });
  });
  pump(); return result;
}

/** Fence callbacks after leaving Travel. Cached geometry keeps its original expiry. */
export function disposeGeocoding() {
  generation++; cooldown = 0; geocoder = geocoderMaps = null;
  for (const job of jobs.values()) finish(job, interrupted());
  jobs.clear(); queue.length = 0; failures.clear();
}
onMapsAuthFailure(() => { disposeGeocoding(); cooldown = Date.now() + 60000; });
globalThis.addEventListener?.('online', () => { cooldown = 0; failures.clear(); });
globalThis.addEventListener?.('pagehide', disposeGeocoding);
