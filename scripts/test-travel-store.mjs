// Browser-only store tests use an in-memory API/storage; no service is contacted.
// Run: node --experimental-vm-modules scripts/test-travel-store.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { normalizeTrip, mergeTrip, canonical } from '../src/shared/travel-data.js';

const source = await readFile(new URL('../src/client/travel-store.js', import.meta.url), 'utf8');
const sharedSource = await readFile(new URL('../src/shared/travel-data.js', import.meta.url), 'utf8');
const copy = value => JSON.parse(JSON.stringify(value));
const trip = (uid = 'old-trip', title = 'Original') => normalizeTrip({ uid, title, created: 100, updated: 100, stops: [{ uid: 'lima', place: 'Lima', stays: [{ uid: 'hotel', name: 'Hotel', nightlyCost: 50 }], activities: [] }] });
class Storage {
  map = new Map(); get length() { return this.map.size; }
  key(index) { return [...this.map.keys()][index] ?? null; }
  getItem(key) { return this.map.get(key) ?? null; }
  setItem(key, value) { this.map.set(key, String(value)); }
  removeItem(key) { this.map.delete(key); }
}
function fixture() {
  const storage = new Storage(), records = new Map(), history = new Map(), aliases = new Map(), mutations = new Map(), calls = [];
  const state = { online: true, connected: true, beforePost: null, afterPost: null, lock: Promise.resolve() };
  const runtimes = new WeakMap();
  storage.setItem('pocket:active-account', 'alice');
  const account = () => storage.getItem('pocket:active-account') || '';
  const dto = record => ({ ...copy(record), role: record.ownerId === account() ? 'owner' : record.members.find(member => member.userId === account())?.role || 'viewer' });
  const allowed = record => record.ownerId === account() || record.members.some(member => member.userId === account());
  const add = (value = trip(), ownerId = 'alice', members = []) => {
    const record = { uid: value.uid, value: copy(value), revision: 1, ownerId, role: 'owner', members, invites: [] };
    records.set(value.uid, record); history.set(value.uid + ':1', copy(value)); return record;
  };
  const update = (uid, patch) => {
    const record = records.get(uid); record.value = normalizeTrip({ ...record.value, ...patch }); record.revision++;
    history.set(uid + ':' + record.revision, copy(record.value)); return record;
  };
  const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => copy(body) });
  async function fetch(url, options = {}) {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push(body || { action: 'get' });
    if (url.includes('?invite=')) return response({ invite: { title: 'Trip', role: 'editor', signedIn: Boolean(account()), eligible: true } });
    if (!body) return response({ accountId: account(), records: [...records.values()].filter(allowed).map(dto) });
    assert.equal(body.accountId, account());
    if (state.beforePost) await state.beforePost(body);
    let result;
    if (body.action === 'create') {
      const localKey = account() + ':' + body.localUid, prior = aliases.get(localKey);
      if (prior) result = { record: dto(records.get(prior)), created: false };
      else {
        const uid = randomUUID(), record = add(normalizeTrip({ ...body.value, uid })); aliases.set(localKey, uid);
        result = { record: dto(record), created: true };
      }
    } else {
      const record = records.get(body.uid);
      if (!record || !allowed(record)) return response({ error: 'Access removed.' }, 403);
      const mutationKey = account() + ':' + body.mutationId, seen = mutations.get(mutationKey);
      if (seen) {
        assert.equal(canonical(body), seen, 'retries must preserve the exact submitted body');
        result = { record: dto(record) };
      } else if (body.action === 'sync') {
        const merged = mergeTrip(history.get(body.uid + ':' + body.baseRevision), body.value, record.value);
        if (merged.conflicts.length) return response({ error: 'Conflict', record: dto(record), conflicts: merged.conflicts }, 409);
        update(body.uid, merged.value); mutations.set(mutationKey, canonical(body)); result = { record: dto(record) };
      } else if (body.action === 'delete') {
        if (body.baseRevision !== record.revision) return response({ error: 'Trip changed before deletion.', record: dto(record), conflicts: [] }, 409);
        record.value = null; record.deleted = true; record.revision++; mutations.set(mutationKey, canonical(body)); result = { record: dto(record) };
      } else throw new Error('Unexpected fixture action: ' + body.action);
    }
    if (state.afterPost) await state.afterPost(body, result);
    return response({ accountId: account(), ...result });
  }
  async function tab() {
    const listeners = new Map(), intervals = new Map(), documentListeners = new Map();
    const document = { visibilityState: 'visible', addEventListener(name, fn) { documentListeners.set(name, fn); } };
    const context = vm.createContext({ console, URL, TextEncoder, crypto: { randomUUID }, localStorage: storage, fetch, Event,
      navigator: { get onLine() { return state.online; }, locks: { request(_name, work) { const next = state.lock.then(work); state.lock = next.catch(() => {}); return next; } } },
      document,
      addEventListener(name, fn) { listeners.set(name, fn); }, dispatchEvent() {},
      setTimeout() { return 1; }, clearTimeout() {}, setInterval(fn, delay) { const id = randomUUID(); intervals.set(id, { fn, delay }); return id; }, clearInterval(id) { intervals.delete(id); },
    });
    const model = new vm.SourceTextModule(sharedSource, { context });
    const workspace = new vm.SyntheticModule(['activeAccount'], function () { this.setExport('activeAccount', account); }, { context });
    const cloud = new vm.SyntheticModule(['connected', 'init'], function () { this.setExport('connected', () => state.connected); this.setExport('init', async () => { state.connected = false; }); }, { context });
    const store = new vm.SourceTextModule(source, { context });
    await store.link(specifier => specifier.includes('workspace-storage') ? workspace : specifier.includes('cloud') ? cloud : model);
    await store.evaluate(); runtimes.set(store.namespace, { intervals, document, documentListeners }); return store.namespace;
  }
  return { storage, records, aliases, state, calls, add, update, tab, account, runtime: store => runtimes.get(store) };
}

{
  const f = fixture(); const a = await f.tab();
  assert.equal(a.readTrips().length, 0, 'signed-in empty shelf does not seed a demo');
  a.saveTrip(trip()); await a.syncTravel();
  const uid = a.lookupAlias('old-trip'); assert.notEqual(uid, 'old-trip'); assert.equal(a.pendingCount(), 0);
  assert.equal(a.readTrips()[0].uid, uid, 'server assigns global trip ID');
  const b = await f.tab(); const renderedA = a.readTrips()[0], renderedB = b.readTrips()[0];
  f.state.online = false;
  a.saveTrip({ ...renderedA, title: 'A title' }); b.saveTrip({ ...renderedB, intention: 'B intention' });
  assert.equal(a.readTrips()[0].title, 'A title'); assert.equal(a.readTrips()[0].intention, 'B intention');
  const reloaded = await f.tab(); assert.equal(reloaded.pendingCount(), 2, 'offline queue survives reload');
  f.state.online = true; await reloaded.syncTravel();
  assert.equal(f.records.get(uid).value.title, 'A title'); assert.equal(f.records.get(uid).value.intention, 'B intention');
  assert.equal(reloaded.pendingCount(), 0);
  const parallelA = a.readTrips()[0], parallelB = b.readTrips()[0];
  a.saveTrip({ ...parallelA, homeCity: 'Munich' }); b.saveTrip({ ...parallelB, countries: 'Peru' });
  await Promise.all([a.syncTravel(), b.syncTravel()]);
  assert.equal(f.records.get(uid).value.homeCity, 'Munich'); assert.equal(f.records.get(uid).value.countries, 'Peru'); assert.equal(a.pendingCount(), 0);
  console.log('PASS global IDs, offline reload, same-browser independent edits');
}
{
  const f = fixture(); f.add(); const a = await f.tab(); await a.syncTravel();
  const captured = a.readTrips()[0];
  f.update('old-trip', { intention: 'Remote decision' }); await a.syncTravel();
  a.saveTrip({ ...captured, title: 'Editor title' }, captured); await a.syncTravel();
  assert.equal(f.records.get('old-trip').value.intention, 'Remote decision'); assert.equal(f.records.get('old-trip').value.title, 'Editor title');
  const sameField = a.readTrips()[0]; f.update('old-trip', { title: 'Their title' }); await a.syncTravel();
  a.saveTrip({ ...sameField, title: 'Our title' }, sameField); await a.syncTravel();
  assert.equal(a.readStatus().conflicts, 1); assert.ok(a.getRecord('old-trip').conflict.paths.includes('title'));
  a.resolveConflict('old-trip', 'local'); await a.syncTravel(); assert.equal(f.records.get('old-trip').value.title, 'Our title');
  const remoteChoice = a.readTrips()[0]; f.update('old-trip', { title: 'Shared winner' }); await a.syncTravel();
  a.saveTrip({ ...remoteChoice, title: 'Local loser', budget: 1234 }, remoteChoice); await a.syncTravel();
  a.resolveConflict('old-trip', 'remote'); await a.syncTravel();
  assert.equal(f.records.get('old-trip').value.title, 'Shared winner'); assert.equal(f.records.get('old-trip').value.budget, 1234, 'choosing shared conflict fields keeps unrelated local edits');
  console.log('PASS captured-editor rebase and explicit same-field conflict resolution');
}
{
  const f = fixture(); f.add(); const a = await f.tab(); await a.syncTravel();
  a.saveTrip({ ...a.readTrips()[0], title: 'Sent title' });
  f.state.beforePost = async body => {
    if (body.action !== 'sync') return; f.state.beforePost = null;
    a.saveTrip({ ...a.readTrips()[0], intention: 'Saved during request' });
  };
  await a.syncTravel(); assert.equal(f.records.get('old-trip').value.intention, 'Saved during request'); assert.equal(a.pendingCount(), 0);
  a.saveTrip({ ...a.readTrips()[0], title: 'Response lost' });
  f.state.afterPost = async () => { f.state.afterPost = null; throw new Error('Connection lost after server commit'); };
  await a.syncTravel(); assert.equal(a.pendingCount(), 1);
  const reloaded = await f.tab(); await reloaded.syncTravel(); assert.equal(reloaded.pendingCount(), 0);
  assert.equal(f.records.get('old-trip').value.title, 'Response lost');
  console.log('PASS in-flight writes and exact idempotent retry after lost response');
}
{
  const f = fixture(); f.add(trip(), 'owner', [{ userId: 'alice', role: 'editor' }]); const a = await f.tab(); await a.syncTravel();
  a.saveTrip({ ...a.readTrips()[0], title: 'Offline edit' });
  f.records.get('old-trip').members = []; await a.syncTravel();
  assert.equal(a.readTrips().length, 0); assert.equal(a.pendingCount(), 0); assert.equal(a.recoveryEntries().length, 1);
  const count = f.calls.filter(call => call.action === 'sync').length; await a.syncTravel(); assert.equal(f.calls.filter(call => call.action === 'sync').length, count);
  f.storage.setItem('pocket:active-account', 'bob'); assert.equal(a.readTrips().length, 0); assert.equal(a.recoveryEntries().length, 0);
  a.saveTrip(trip('bobs-trip', 'Bob')); assert.equal(a.pendingCount(), 1);
  f.storage.setItem('pocket:active-account', 'alice'); assert.equal(a.pendingCount(), 0);
  console.log('PASS revocation recovery, stopped writes, account isolation');
}
{
  const f = fixture(); f.add(); const a = await f.tab(); await a.syncTravel();
  a.saveTrip({ ...a.readTrips()[0], title: 'Alice pending edit' });
  f.state.beforePost = async body => { if (body.action === 'sync') { f.state.beforePost = null; f.storage.setItem('pocket:active-account', 'bob'); } };
  await a.syncTravel(); assert.equal(a.readTrips().length, 0); assert.equal(a.pendingCount(), 0);
  f.storage.setItem('pocket:active-account', 'alice'); assert.equal(a.pendingCount(), 1); assert.equal(a.readTrips()[0].title, 'Alice pending edit');
  const reloaded = await f.tab(); await reloaded.syncTravel(); assert.equal(reloaded.pendingCount(), 0); assert.equal(f.records.get('old-trip').value.title, 'Alice pending edit');
  console.log('PASS in-flight account-switch fencing preserves original account queue');
}
{
  const f = fixture(), original = JSON.stringify({ v: 2, trips: [trip()] });
  f.storage.setItem('pocket:account:alice:pocket:travel-v2', original);
  const a = await f.tab(); assert.equal(a.readTrips().length, 1); await a.syncTravel();
  const uid = a.lookupAlias('old-trip'); f.update(uid, { title: 'Current shared trip', stops: [] });
  const second = fixture(); second.records.set(uid, copy(f.records.get(uid))); second.aliases.set('alice:old-trip', uid);
  second.storage.setItem('pocket:account:alice:pocket:travel-v2', original);
  const b = await second.tab(); b.readTrips(); await b.syncTravel();
  assert.equal(b.readTrips()[0].title, 'Current shared trip'); assert.equal(b.readTrips()[0].stops.length, 0);
  assert.equal(b.recoveryEntries().length, 1); assert.equal(second.storage.getItem('pocket:account:alice:pocket:travel-store:original-raw'), original);
  assert.equal(second.calls.filter(call => call.action === 'sync').length, 0, 'stale imports do not recreate deleted nested data');
  console.log('PASS deterministic migration, immutable raw backup, stale import recovery');
}
{
  const f = fixture(); f.storage.setItem('pocket:account:alice:pocket:travel-v2', JSON.stringify({ v: 2, trips: [null, ...Array.from({ length: 81 }, (_value, index) => trip('trip-' + index))] }));
  const a = await f.tab(); assert.equal(a.readTrips().length, 79); assert.equal(a.recoveryEntries().length, 3);
  const corrupt = fixture(); corrupt.storage.setItem('pocket:account:alice:pocket:travel-v2', '{broken');
  const b = await corrupt.tab(); assert.equal(b.readTrips().length, 0); assert.equal(b.recoveryEntries()[0].raw, '{broken');
  console.log('PASS malformed and excess legacy data preserved for recovery');
}
{
  const f = fixture(); const a = await f.tab(); a.readTrips();
  const source = [{ accountId: 'another-account', uid: 'invalid-old-trip', reason: 'Unreadable legacy data', value: { title: '' }, raw: '{broken', operations: [] }];
  assert.equal(a.importRecoveryEntries(source), 1); assert.equal(a.pendingCount(), 0); assert.equal(a.recoveryEntries()[0].accountId, 'alice');
  assert.equal(a.recoveryEntries()[0].raw, '{broken'); assert.equal(a.readTrips().length, 0);
  assert.throws(() => a.importRecoveryEntries([{ raw: 12 }]), /invalid original/);
  assert.throws(() => a.importRecoveryEntries(Array(501).fill({ value: null })), /500 recovery/);
  await a.syncTravel(); assert.equal(f.calls.filter(call => call.action !== 'get').length, 0);
  console.log('PASS bounded account-scoped recovery import never uploads artifacts');
}
{
  const f = fixture(); f.add(); const a = await f.tab(); await a.syncTravel(); const revision = a.getRecord('old-trip').revision;
  a.deleteTrip('old-trip', revision); f.update('old-trip', { title: 'Changed after delete click' }); await a.syncTravel();
  assert.equal(a.readStatus().conflicts, 1); assert.ok(f.records.get('old-trip').value);
  a.resolveConflict('old-trip', 'remote'); assert.equal(a.readTrips()[0].title, 'Changed after delete click');
  f.records.get('old-trip').role = 'viewer'; f.records.get('old-trip').ownerId = 'owner'; f.records.get('old-trip').members = [{ userId: 'alice', role: 'viewer' }];
  await a.syncTravel(); assert.throws(() => a.saveTrip({ ...a.readTrips()[0], title: 'Forbidden' }), /view this trip/);
  f.storage.removeItem('pocket:active-account'); const guest = await f.tab(); guest.readTrips(trip('guest-trip')); guest.saveTrip({ ...guest.readTrips()[0], title: 'Guest edit' });
  const before = f.calls.length; await guest.syncTravel(); assert.equal(f.calls.length, before); assert.equal(guest.readTrips()[0].title, 'Guest edit');
  console.log('PASS stale delete conflict, viewer write denial, anonymous local behavior');
}
{
  const f = fixture(); f.add(); const a = await f.tab(), runtime = f.runtime(a);
  a.startLive(); await a.syncTravel();
  assert.equal(runtime.intervals.size, 1);
  assert.equal([...runtime.intervals.values()][0].delay, 5000);
  f.update('old-trip', { title: 'Live partner edit' });
  await [...runtime.intervals.values()][0].fn();
  assert.equal(a.readTrips()[0].title, 'Live partner edit');
  runtime.document.visibilityState = 'hidden'; runtime.documentListeners.get('visibilitychange')();
  assert.equal(runtime.intervals.size, 0, 'hidden tabs pause live polling');
  f.update('old-trip', { title: 'Changed while hidden' });
  runtime.document.visibilityState = 'visible'; runtime.documentListeners.get('visibilitychange')(); await a.syncTravel();
  assert.equal(a.readTrips()[0].title, 'Changed while hidden', 'returning to tab refreshes immediately');
  a.stopLive(); assert.equal(runtime.intervals.size, 0, 'leaving Travel disposes live polling');
  console.log('PASS live partner updates, hidden-tab pause, immediate resume and disposal');
}
console.log('Travel store fixtures passed.');
