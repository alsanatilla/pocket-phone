// Run: node --experimental-vm-modules scripts/travel-context-check.mjs
// Travel serializers and the actual ChatStore/ReplyRunner run in an isolated VM.
// Provider transport, account storage and all browser services are local fixtures.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { travelDraft, TRAVEL_CONTEXT_LIMIT } from '../src/shared/travel-context.js';
import { sanitizeObject, validObject } from '../src/shared/objects.js';
import { reorderTrip } from '../src/shared/travel-planning.js';

const copy = value => JSON.parse(JSON.stringify(value));
const trip = {
  uid: 'trip-fixture', title: 'Together in Peru', departure: '2028-01-03', returnDate: '2028-01-18', homeArrival: '2028-01-19',
  homeCity: 'Berlin', travelers: 'Lena and Nora', budget: 2400, currency: 'EUR', intention: 'Quiet stays near the centre',
  stops: [
    { uid: 'lima', place: 'Lima', country: 'Peru', arrival: '2028-01-04', departure: '2028-01-06', nights: 2, currency: 'PEN', stays: [] },
    { uid: 'cusco', place: 'Cusco', country: 'Peru', arrival: '2028-01-06', departure: '2028-01-10', nights: 4, currency: 'PEN', guidance: 'Keep the first day easy',
      connection: { mode: 'flight', label: 'Lima → Cusco', date: '2028-01-06', cost: 120, currency: 'EUR', status: 'shortlist' },
      stays: [
        { uid: 'stay-a', name: 'Casa A', kind: 'guesthouse', status: 'shortlist', currency: 'PEN', nightlyCost: 80, totalCost: '',
          checkIn: '2028-01-06', checkOut: '2028-01-10', cancelBy: '2028-01-04', address: 'Plaza San Blas 12', note: 'Free cancellation before the saved deadline; breakfast included.', url: 'https://example.com/casa-a', bookingRef: 'private-booking-reference' },
        { uid: 'stay-b', name: 'Casa B', kind: 'hotel', status: 'booked', currency: 'EUR', nightlyCost: '', totalCost: 0,
          checkIn: '', checkOut: '', cancelBy: '', address: 'Calle Nueva 3', note: 'Already paid with a voucher', url: '' },
      ] },
    { uid: 'puno', place: 'Puno', country: 'Peru', arrival: '2028-01-10', departure: '2028-01-12', nights: 2, currency: 'PEN', stays: [],
      connection: { mode: 'bus', label: 'Cusco → Puno', date: '2028-01-10', cost: '', currency: 'PEN', status: 'idea' } },
  ],
};
{
  const prepared = travelDraft(trip, trip.stops[1], 'compare'), data = JSON.parse(prepared.context.text);
  assert.equal(prepared.context.kind, 'travel'); assert.equal(prepared.context.href, '/travel/trip-fixture/stop/cusco');
  assert.equal(data.selectedDestination.name, 'Cusco'); assert.equal(data.selectedDestination.arrival, '2028-01-06');
  assert.equal(data.selectedDestination.departure, '2028-01-10'); assert.equal(data.selectedDestination.nights, 4);
  assert.equal(data.trip.budget, 2400); assert.equal(data.trip.currency, 'EUR');
  assert.equal(data.nextDestination.name, 'Puno'); assert.equal(data.previousDestination.name, 'Lima');
  assert.equal(data.selectedDestination.routePosition, 2); assert.equal(data.incomingConnection.cost, 120);
  assert.equal(data.incomingConnection.needsReview, false);
  assert.equal(data.nextSavedConnection.mode, 'bus'); assert.equal(data.nextSavedConnection.date, '2028-01-10'); assert.equal(data.nextSavedConnection.cost, null);
  const saved = name => Object.fromEntries(data.stayColumns.map((key, index) => [key, data.savedStays.find(row => row[1] === name)[index]]));
  assert.equal(saved('Casa A').nightlyCost, 80); assert.equal(saved('Casa A').totalCost, null);
  assert.equal(saved('Casa A').cancelBy, '2028-01-04'); assert.equal(saved('Casa A').currency, 'PEN');
  assert.equal(saved('Casa B').totalCost, 0); assert.equal(saved('Casa B').checkIn, null); assert.equal(saved('Casa B').cancelBy, null);
  assert.ok(data.details.some(detail => detail.field === 'stayAddress' && detail.value === 'Plaza San Blas 12'));
  assert.ok(data.details.some(detail => detail.field === 'stayNoteIncludingCancellationTerms' && detail.value.includes('Free cancellation')));
  assert.ok(data.details.some(detail => detail.field === 'stayLink' && detail.value === 'https://example.com/casa-a'));
  assert.ok(!prepared.context.text.includes('private-booking-reference'), 'Research does not need booking secrets');
  assert.match(prepared.draft, /Do not invent prices/); assert.match(prepared.draft, /book anything or edit the trip/);
  assert.match(prepared.draft, /only if this chat already offers them/);
  console.log('PASS exact selected destination, budget, saved stay costs, location, dates and cancellation');
}
{
  const sparse = { uid: 'sparse', title: 'Undecided', stops: [{ uid: 'stop', place: 'Somewhere', stays: [] }] };
  const data = JSON.parse(travelDraft(sparse, 'stop', 'find').context.text);
  assert.equal(data.trip.budget, null); assert.equal(data.trip.currency, null); assert.equal(data.selectedDestination.arrival, null);
  assert.equal(data.selectedDestination.nights, null); assert.equal(data.nextDestination, null); assert.deepEqual(data.savedStays, []);
  assert.throws(() => travelDraft(trip, 'removed-stop'), /no longer/); assert.throws(() => travelDraft(trip, 'cusco', 'book'), /Choose a Travel action/);
  const before = JSON.stringify(trip); for (const action of ['find', 'compare', 'next']) assert.ok(travelDraft(trip, 'cusco', action).draft);
  assert.equal(JSON.stringify(trip), before, 'Preparing a handoff never mutates a trip');
  console.log('PASS unknown facts, invalid selection rejection and mutation-free actions');
}
{
  const huge = copy(trip), selected = huge.stops[1];
  huge.stops = Array.from({ length: 80 }, (_value, index) => ({ ...copy(trip.stops[0]), uid: 'far-' + index, place: ('Far destination ' + index + ' ').repeat(10).slice(0, 140) }));
  huge.stops.splice(40, 1, selected);
  selected.stays = Array.from({ length: 20 }, (_value, index) => ({ ...copy(trip.stops[1].stays[0]), name: ('Saved stay ' + index + ' ').repeat(12).slice(0, 140),
    status: index === 19 ? 'booked' : 'shortlist', totalCost: index === 19 ? 123.45 : '',
    address: 'Long address '.repeat(30), note: 'Cancellation terms '.repeat(80), url: 'https://example.com/' + 'x'.repeat(1800) }));
  const prepared = travelDraft(huge, selected, 'compare'), data = JSON.parse(prepared.context.text);
  assert.ok(prepared.context.text.length <= TRAVEL_CONTEXT_LIMIT); assert.ok(prepared.context.originalLength > prepared.context.text.length);
  assert.equal(data.selectedDestination.name, 'Cusco'); assert.equal(data.selectedDestination.arrival, '2028-01-06');
  assert.equal(data.selectedDestination.departure, '2028-01-10'); assert.equal(data.trip.budget, 2400);
  assert.equal(data.incomingConnection.label, 'Lima → Cusco');
  const booked = data.savedStays.find(row => row[3] === 'booked'); assert.ok(booked); assert.equal(booked[6], 123.45); assert.equal(booked[9], '2028-01-04');
  assert.ok(data.omitted.detailFields > 0); assert.ok(data.omitted.routeStops > 0);
  console.log('PASS large snapshots stay within 8,000 characters and retain destination and booked-stay facts');
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
const urls = {
  pip: new URL('../src/client/pip.js', import.meta.url), core: new URL('../src/client/pip-core.js', import.meta.url),
  travel: new URL('../src/shared/travel-context.js', import.meta.url), activity: new URL('../src/client/pip-activity.js', import.meta.url),
};
const sources = Object.fromEntries(await Promise.all(Object.entries(urls).map(async ([key, url]) => [key, await readFile(url, 'utf8')])));
async function fixture(webSearch = false) {
  const storage = new MemoryStorage(), tabs = new MemoryStorage(), state = { providerCalls: [], grants: ['notes'], changes: [] };
  const settings = { provider: 'compatible', model: 'openrouter/free', baseUrl: 'https://openrouter.ai/api/v1', maxTokens: 2048, thinking: false, webSearch };
  storage.setItem('pocket:pip-settings', JSON.stringify(settings));
  tabs.setItem('pocket:pip-key:' + settings.baseUrl, 'fixture-provider-key');
  const context = vm.createContext({ console, URL, structuredClone, crypto: { randomUUID }, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, DOMException, addEventListener: () => {},
    document: { getElementById: () => null }, fetch: () => { throw new Error('Fixture prohibits network calls.'); } });
  const synthetic = exports => new vm.SyntheticModule(Object.keys(exports), function () { for (const [key, value] of Object.entries(exports)) this.setExport(key, value); }, { context });
  const unused = () => { throw new Error('Unexpected browser action in Travel draft fixture.'); };
  const dependencies = {
    './workspace-storage.js': synthetic({ storage, tabStorage: tabs }),
    './persistence-events.js': synthetic({ changed: (...args) => state.changes.push(args) }),
    './pip-tools.js': synthetic({ CATEGORIES: [], access: () => state.grants.slice(), accessFingerprint: () => 'fixture-grants', saveAccess: unused,
      definitions: () => [], STATE_TOOLS: [], firecrawlKey: () => '', setFirecrawlKey: unused, changeName: unused, changeTarget: unused }),
    './pip-stream.js': synthetic({ streamChat: async (_chat, _turn, options) => { state.providerCalls.push(copy(options.body)); return { answer: 'Fixture answer', reasoning: '', activity: [], sources: [] }; } }),
    './store.js': synthetic({ notes: unused, tasks: unused, parking: unused, noteTitle: unused, receipt: unused, KIND: {} }),
    './pip-pixels.js': synthetic({ mascot: unused }), './pixel-backdrop.js': synthetic({ backdrop: unused }),
    './pip-actions.js': synthetic({ applyProposal: unused, applyChange: unused, applyCoros: unused }),
    '../shared/coros-course.js': synthetic(Object.fromEntries(['corosAction', 'corosCourse', 'corosDated', 'corosDate', 'corosProblem', 'corosTitle', 'courseLines', 'sportName'].map(key => [key, unused]))),
  };
  const modules = Object.fromEntries(Object.entries(sources).map(([key, value]) => [key, new vm.SourceTextModule(value, { context })]));
  dependencies['./pip-core.js'] = modules.core; dependencies['./pip-activity.js'] = modules.activity; dependencies['../shared/travel-context.js'] = modules.travel;
  await modules.pip.link(path => { if (!dependencies[path]) throw new Error('Unstubbed fixture import: ' + path); return dependencies[path]; });
  await modules.pip.evaluate();
  return { pip: modules.pip.namespace, core: modules.core.namespace, storage, tabs, state, settings };
}
{
  const f = await fixture(), store = new f.core.ChatStore(f.storage), old = store.create();
  store.update(old.uid, chat => { chat.title = 'Keep this chat'; chat.draft = 'Unsent old message'; chat.context = [{ kind: 'note', uid: 'note', title: 'Old source', text: 'Keep me' }]; });
  f.storage.setItem('pocket:pip-current', old.uid);
  const previous = f.storage.getItem('pocket:pip-chat:' + old.uid), settingsBefore = f.storage.getItem('pocket:pip-settings');
  const uid = f.pip.withTravel(trip, trip.stops[1], 'find'), chat = store.get(uid);
  assert.notEqual(uid, old.uid); assert.equal(f.storage.getItem('pocket:pip-chat:' + old.uid), previous);
  assert.equal(f.storage.getItem('pocket:pip-current'), old.uid); assert.equal(chat.turns.length, 0); assert.equal(chat.context.length, 1);
  assert.equal(chat.context[0].kind, 'travel'); assert.equal(chat.config.webSearch, false); assert.equal(f.storage.getItem('pocket:pip-settings'), settingsBefore);
  assert.deepEqual(f.state.grants, ['notes']); assert.equal(f.state.providerCalls.length, 0, 'Creating a draft sends no provider request');
  assert.equal(validObject('chats', copy(chat)), true); assert.equal(sanitizeObject('chats', chat).context[0].kind, 'travel', 'Travel context survives cloud sanitation');
  const beforeInvalid = store.list().length;
  assert.throws(() => f.pip.withTravel(trip, 'missing'), /no longer/); assert.equal(store.list().length, beforeInvalid);
  const second = f.pip.withTravel(trip, 'cusco', 'next'); assert.notEqual(second, uid); assert.equal(store.get(uid).draft, chat.draft);
  const runner = new f.core.ReplyRunner(store);
  await runner.send(uid, { text: chat.draft, context: chat.context });
  assert.equal(f.state.providerCalls.length, 1); assert.ok(f.state.providerCalls[0].messages.at(-1).content.includes(chat.context[0].text));
  assert.match(f.state.providerCalls[0].messages[0].content, /Web search is off/); assert.equal(store.get(uid).turns[0].status, 'done');
  assert.equal(f.storage.getItem('pocket:pip-chat:' + old.uid), previous);
  console.log('PASS real Pip handoff creates separate sync-valid drafts without provider requests or permission changes; explicit Send uses the actual runner');
}
{
  const f = await fixture(true), store = new f.core.ChatStore(f.storage);
  const uid = f.pip.withTravel(trip, 'cusco', 'compare');
  assert.equal(store.get(uid).config.webSearch, true); assert.equal(f.state.providerCalls.length, 0); assert.deepEqual(f.state.grants, ['notes']);
  console.log('PASS previously enabled search is inherited without widening Pocket access');
}
{
  const original = copy(trip);
  original.returnJourney = { label: 'Puno → home', date: '2028-01-18', cost: 300, currency: 'EUR', status: 'booked', needsReview: false };
  const before = JSON.stringify(original), reordered = reorderTrip(original, 'cusco', 2);
  assert.equal(reordered.changed, true); assert.deepEqual(reordered.trip.stops.map(stop => stop.uid), ['lima', 'puno', 'cusco']);
  const prepared = travelDraft(reordered.trip, 'puno', 'next'), data = JSON.parse(prepared.context.text);
  assert.equal(data.selectedDestination.name, 'Puno'); assert.equal(data.nextDestination.name, 'Cusco');
  assert.equal(data.incomingConnection.needsReview, true); assert.equal(data.nextSavedConnection.needsReview, true);
  assert.equal(data.returnConnection.needsReview, true); assert.equal(data.returnConnection.status, 'booked'); assert.equal(data.returnConnection.cost, 300);
  assert.equal(data.incomingConnection.label, 'Cusco → Puno'); assert.equal(data.nextSavedConnection.label, 'Lima → Cusco');
  assert.match(prepared.draft, /Recheck connections marked needsReview/); assert.match(prepared.draft, /even if they are booked/);
  assert.equal(JSON.stringify(original), before);
  const f = await fixture(), store = new f.core.ChatStore(f.storage), uid = f.pip.withTravel(reordered.trip, 'puno', 'next');
  const chat = store.get(uid); assert.equal(f.state.providerCalls.length, 0); assert.equal(chat.turns.length, 0);
  assert.equal(chat.config.webSearch, false); assert.deepEqual(f.state.grants, ['notes']);
  assert.equal(JSON.parse(chat.context[0].text).returnConnection.needsReview, true);
  await new f.core.ReplyRunner(store).send(uid, { text: chat.draft, context: chat.context });
  assert.equal(f.state.providerCalls.length, 1); assert.ok(f.state.providerCalls[0].messages.at(-1).content.includes('"needsReview":true'));
  assert.match(f.state.providerCalls[0].messages.at(-1).content, /Recheck connections marked needsReview/);
  console.log('PASS reordered routes carry incoming, next and return review flags through unsent drafts and explicit Send');
}
console.log('Travel context fixtures passed.');
