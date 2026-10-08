// Run: node --experimental-vm-modules scripts/travel-geocoding-check.mjs
// All SDK, geocoder, fetch, storage, clock and DOM operations are isolated fixtures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const loaderSource = await readFile(new URL('../src/client/google-maps.js', import.meta.url), 'utf8');
const geocoderSource = await readFile(new URL('../src/client/travel-geocoding.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
const CACHE = 'pocket:travel-google-geocoding-v1';
function clock() {
  const state = { now: 1000000000000, timers: new Map(), next: 0 };
  class FixtureDate extends Date { static now() { return state.now; } }
  return { state, Date: FixtureDate, setTimeout: (fn, delay) => { const id = ++state.next; state.timers.set(id, { fn, at: state.now + delay }); return id; },
    clearTimeout: id => state.timers.delete(id), async tick(ms) { state.now += ms; for (const [id, timer] of [...state.timers]) if (timer.at <= state.now) { state.timers.delete(id); timer.fn(); } await flush(); } };
}
async function loaderFixture(options = {}) {
  const time = clock(), state = { fetches: [], scripts: [], listeners: new Map(), imports: [] };
  const maps = Object.fromEntries(['Map', 'OverlayView', 'Polyline', 'LatLngBounds', 'Geocoder'].map(name => [name, class {}]));
  maps.importLibrary = async name => { state.imports.push(name); return maps; };
  const context = vm.createContext({ console, URL, URLSearchParams, AbortController, DOMException, queueMicrotask, Date: time.Date, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    navigator: { onLine: true }, addEventListener: (name, fn) => state.listeners.set(name, fn),
    fetch: async (path, args) => { state.fetches.push({ path, args }); if (options.fetch) return options.fetch(); return { ok: true, json: async () => options.config || { enabled: true, key: 'fixture_browser_key_0123456789' } }; },
    document: { querySelector: () => ({ nonce: 'fixture-nonce' }), createElement: () => ({ remove() { this.removed = true; } }), head: { append: script => state.scripts.push(script) } } });
  const module = new vm.SourceTextModule(loaderSource, { context }); await module.link(() => { throw new Error('Unexpected loader import'); }); await module.evaluate();
  const loaded = async (index = state.scripts.length - 1) => { context.google = { maps }; await context[new URL(state.scripts[index].src).searchParams.get('callback')](); await flush(); };
  return { api: module.namespace, state, context, maps, time, loaded };
}
{
  const f = await loaderFixture(), first = f.api.loadGoogleMaps(), second = f.api.loadGoogleMaps(); await flush();
  assert.equal(f.state.fetches.length, 1); assert.equal(f.state.fetches[0].path, '/api/maps-config'); assert.equal(f.state.scripts.length, 1);
  const script = f.state.scripts[0], url = new URL(script.src);
  assert.equal(script.async, true); assert.equal(script.nonce, 'fixture-nonce'); assert.equal(url.searchParams.get('loading'), 'async'); assert.equal(url.searchParams.get('v'), 'quarterly');
  await f.loaded(); assert.equal(await first, f.maps); assert.equal(await second, f.maps); assert.deepEqual(f.state.imports, ['maps', 'geocoding']);
  assert.equal(await f.api.loadGoogleMaps(), f.maps); assert.equal(f.state.fetches.length, 1); assert.equal(f.api.mapsStatus().state, 'ready');
  console.log('PASS one on-demand runtime-key SDK load, explicit async callback, quarterly channel and shared library readiness');
}
{
  const f = await loaderFixture(), controller = new AbortController(), first = f.api.loadGoogleMaps({ signal: controller.signal }), second = f.api.loadGoogleMaps();
  const cancelled = assert.rejects(first, error => error.name === 'AbortError'); controller.abort(); await cancelled; await flush(); await f.loaded(); assert.equal(await second, f.maps);
  let failures = 0; const unsubscribe = f.api.onMapsAuthFailure(() => failures++);
  f.context.gm_authFailure(); assert.equal(failures, 1); unsubscribe(); f.context.gm_authFailure(); assert.equal(failures, 1);
  await assert.rejects(f.api.loadGoogleMaps(), error => error.code === 'auth' && !error.message.includes('fixture_browser_key'));
  console.log('PASS caller abort does not cancel shared loader and late authentication failure notifies/blocks safely');
}
{
  const f = await loaderFixture(), first = f.api.loadGoogleMaps(), timedOut = assert.rejects(first, error => error.code === 'timeout'); await flush();
  await f.time.tick(12000); await timedOut; assert.equal(f.state.scripts[0].removed, true);
  f.state.listeners.get('online')(); const retried = f.api.loadGoogleMaps(); await flush(); assert.equal(f.state.scripts.length, 2); await f.loaded(); assert.equal(await retried, f.maps);
  const disabled = await loaderFixture({ config: { enabled: false } }); await assert.rejects(disabled.api.loadGoogleMaps(), error => error.code === 'disabled'); assert.equal(disabled.state.scripts.length, 0);
  const broken = await loaderFixture({ fetch: () => { throw new Error('https://provider.example/?key=fixture_browser_key_0123456789'); } });
  await assert.rejects(broken.api.loadGoogleMaps(), error => !error.message.includes('https:') && !error.message.includes('fixture_browser_key'));
  console.log('PASS finite timeout, reconnect retry, disabled config and sanitized network failure');
}

function googleResult(placeId = 'place-fixture', overrides = {}) {
  return { place_id: placeId, formatted_address: 'Returned address that must not be persisted', partial_match: false,
    address_components: [{ short_name: 'PE', long_name: 'Peru', types: ['country'] }], geometry: { location: { lat: () => -13.52, lng: () => -71.96 }, location_type: 'APPROXIMATE' }, ...overrides };
}
async function geocoderFixture() {
  const time = clock(), state = { account: 'alice', values: new Map(), calls: [], loaders: 0, events: new Map(), authFailure: null };
  const storage = { getItem: key => state.values.get(state.account + ':' + key) ?? null, setItem: (key, value) => state.values.set(state.account + ':' + key, value) };
  class Geocoder { geocode(request, callback) { state.calls.push({ request: copy(request), callback }); } }
  const context = vm.createContext({ console, URL, structuredClone, DOMException, Date: time.Date, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    navigator: { onLine: true, languages: ['de', 'en'] }, addEventListener: (name, fn) => state.events.set(name, fn), fetch: () => { throw new Error('Fixture prohibits networking'); } });
  const maps = new vm.SyntheticModule(['loadGoogleMaps', 'onMapsAuthFailure'], function () {
    this.setExport('loadGoogleMaps', async () => { state.loaders++; return { Geocoder }; });
    this.setExport('onMapsAuthFailure', listener => { state.authFailure = listener; return () => {}; });
  }, { context });
  const workspace = new vm.SyntheticModule(['activeAccount', 'storage'], function () { this.setExport('activeAccount', () => state.account); this.setExport('storage', storage); }, { context });
  const module = new vm.SourceTextModule(geocoderSource, { context }); await module.link(path => path.includes('google-maps') ? maps : workspace); await module.evaluate();
  const reply = async (index, results = [googleResult()], status = 'OK') => { state.calls[index].callback(results, status); await flush(); };
  const cached = (account = state.account) => JSON.parse(state.values.get(account + ':' + CACHE) || '{"entries":[]}').entries;
  return { api: module.namespace, state, context, time, storage, reply, cached };
}
{
  const f = await geocoderFixture(), subject = { place: '  Cusco  ', country: 'Peru' }, a = f.api.resolveLocation(subject), b = f.api.resolveLocation(subject);
  await flush(); assert.equal(f.state.calls.length, 1); assert.equal(f.state.calls[0].request.address, 'Cusco, Peru'); assert.equal(f.state.calls[0].request.componentRestrictions.country, 'PE');
  await f.reply(0); const value = await a; assert.equal(value.status, 'resolved'); assert.equal(value.location.approximate, true); assert.deepEqual(copy(value), copy(await b));
  assert.equal(value.location.lat, -13.52); assert.equal(f.cached().length, 1); assert.ok(!JSON.stringify(f.cached()).includes('Returned address'));
  const originalExpiry = f.cached()[0].created; await f.time.tick(10000); assert.equal((await f.api.resolveLocation(subject)).status, 'resolved'); assert.equal(f.state.calls.length, 1); assert.equal(f.cached()[0].created, originalExpiry);
  f.state.account = 'bob'; const other = f.api.resolveLocation(subject); await flush(); assert.equal(f.state.calls.length, 2); await f.reply(1); await other; assert.equal(f.cached('alice').length, 1); assert.equal(f.cached('bob').length, 1);
  console.log('PASS exact unique country match, query dedup, approximate flag, account-scoped minimal cache and non-sliding expiry');
}
{
  const f = await geocoderFixture(), subject = { place: 'La Paz', country: 'Bolivien' };
  let result = f.api.resolveLocation(subject); await flush(); assert.equal(f.state.calls[0].request.componentRestrictions.country, 'BO');
  await f.reply(0, [googleResult('bolivia', { address_components: [{ short_name: 'BO', long_name: 'Bolivia', types: ['country'] }], partial_match: true })]);
  let partial = await result; assert.equal(partial.status, 'ambiguous'); assert.equal(partial.candidates.length, 1); assert.equal(f.cached().length, 0);
  const chosen = { ...subject, location: { placeId: partial.candidates[0].placeId, query: f.api.locationQuery(subject) } };
  result = f.api.resolveLocation(chosen); await flush(); assert.deepEqual(f.state.calls[1].request, { placeId: 'bolivia' });
  await f.reply(1, [googleResult('bolivia', { address_components: [{ short_name: 'BO', long_name: 'Bolivia', types: ['country'] }], partial_match: true })]); assert.equal((await result).status, 'resolved');
  const changed = { ...chosen, place: 'Sucre' }; result = f.api.resolveLocation(changed); await flush(); assert.equal(f.state.calls[2].request.address, 'Sucre, Bolivien');
  await f.reply(2, [googleResult('wrong-country')]); assert.equal((await result).status, 'unresolved');
  result = f.api.resolveLocation({ place: 'Springfield', country: 'US' }); await flush();
  await f.reply(3, [googleResult('one', { address_components: [{ short_name: 'US', types: ['country'] }] }), googleResult('two', { address_components: [{ short_name: 'US', types: ['country'] }] })]);
  assert.equal((await result).status, 'ambiguous');
  console.log('PASS German country alias, partial/multiple confirmation, explicit placeId lookup and stale-query invalidation');
}
{
  const f = await geocoderFixture(), controller = new AbortController(), subject = { place: 'Cusco', country: 'Peru' };
  const aborted = f.api.resolveLocation(subject, { signal: controller.signal }), retained = f.api.resolveLocation(subject);
  const rejection = assert.rejects(aborted, error => error.name === 'AbortError'); await flush(); controller.abort(); await rejection; await f.reply(0); assert.equal((await retained).status, 'resolved');
  const changed = { place: 'Puno', country: 'Peru' }, stale = f.api.resolveLocation(changed); await flush(); changed.place = 'Lima'; await f.reply(1); assert.equal((await stale).status, 'unavailable'); assert.equal(f.cached().length, 1);
  const switched = f.api.resolveLocation({ place: 'Arequipa', country: 'Peru' }); await flush(); f.state.account = 'bob'; await f.reply(2); assert.equal((await switched).status, 'unavailable'); assert.equal(f.cached('bob').length, 0);
  f.state.account = 'alice'; const cached = f.api.resolveLocation(subject); f.state.account = 'bob'; assert.equal((await cached).status, 'unavailable');
  const disposed = f.api.resolveLocation({ place: 'New city', country: 'Peru' }); await flush(); f.api.disposeGeocoding(); assert.equal((await disposed).status, 'unavailable'); await f.reply(3); assert.equal(f.cached('bob').length, 0);
  console.log('PASS abort sharing, changed-input/account fences including cached fast path and disposal suppress stale geometry');
}
{
  const f = await geocoderFixture(), pending = Array.from({ length: 5 }, (_value, index) => f.api.resolveLocation({ place: 'City ' + index, country: 'Peru' }));
  await flush(); assert.equal(f.state.calls.length, 3); await f.reply(0); assert.equal(f.state.calls.length, 4); await f.reply(1); assert.equal(f.state.calls.length, 5);
  await f.reply(2); await f.reply(3); await f.reply(4); assert.ok((await Promise.all(pending)).every(result => result.status === 'resolved'));
  const missing = f.api.resolveLocation({ place: 'Missing', country: 'Peru' }); await flush(); await f.reply(5, [], 'ZERO_RESULTS'); assert.equal((await missing).status, 'unresolved');
  assert.equal((await f.api.resolveLocation({ place: 'Missing', country: 'Peru' })).status, 'unresolved'); assert.equal(f.state.calls.length, 6);
  const retry = f.api.resolveLocation({ place: 'Missing', country: 'Peru' }, { refresh: true }); await flush(); assert.equal(f.state.calls.length, 7); await f.reply(6); assert.equal((await retry).status, 'resolved');
  const quota = f.api.resolveLocation({ place: 'Quota', country: 'Peru' }); await flush(); await f.reply(7, [], 'OVER_QUERY_LIMIT'); assert.equal((await quota).status, 'unavailable');
  assert.equal((await f.api.resolveLocation({ place: 'Another quota', country: 'Peru' })).status, 'unavailable'); assert.equal(f.state.calls.length, 8);
  f.state.events.get('online')(); const reconnect = f.api.resolveLocation({ place: 'Another quota', country: 'Peru' }, { refresh: true }); await flush(); assert.equal(f.state.calls.length, 9); await f.reply(8); assert.equal((await reconnect).status, 'resolved');
  const timeout = f.api.resolveLocation({ place: 'Never answers', country: 'Peru' }); await flush(); await f.time.tick(12000); assert.equal((await timeout).status, 'unavailable');
  console.log('PASS concurrency limited to three, negative cache/manual retry, quota cooldown, reconnect and finite geocoder timeout');
}
{
  const f = await geocoderFixture(), subject = { place: 'Cusco', country: 'Peru' }, pending = f.api.resolveLocation(subject); await flush(); await f.reply(0); await pending;
  await f.time.tick(30 * 86400000 + 1); const expired = f.api.resolveLocation(subject); await flush(); assert.equal(f.cached().length, 0); assert.equal(f.state.calls.length, 2); await f.reply(1); await expired;
  const now = f.time.state.now;
  f.storage.setItem(CACHE, JSON.stringify({ version: 1, entries: Array.from({ length: 200 }, (_value, index) => ({ key: 'Cached ' + index + ', Peru\n', lat: 1, lng: 2, placeId: 'cached-' + index, approximate: false, created: now - 1000, used: now - 1000 + index })) }));
  await f.api.resolveLocation({ place: 'Cached 0', country: 'Peru' }); const newest = f.api.resolveLocation({ place: 'Newest', country: 'Peru' }); await flush(); await f.reply(2); await newest;
  assert.equal(f.cached().length, 200); assert.ok(f.cached().some(value => value.placeId === 'cached-0')); assert.ok(!f.cached().some(value => value.placeId === 'cached-1'));
  const abandoned = f.api.resolveLocation({ place: 'Auth failure', country: 'Peru' }); await flush(); f.state.authFailure(); assert.equal((await abandoned).status, 'unavailable'); await f.reply(3); assert.ok(!f.cached().some(value => value.key.startsWith('Auth failure')));
  console.log('PASS 30-day coordinate expiry, maximum-200 LRU eviction and auth-failure suppression');
}
console.log('Google Maps loader/geocoding fixtures passed without network or production data.');
