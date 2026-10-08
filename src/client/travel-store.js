import { activeAccount } from './workspace-storage.js';
import * as cloud from './cloud.js';
import { normalizeTrip, mergeTrip, canonical } from '../shared/travel-data.js';

// Each edit has its own key. Two tabs can append synchronously without replacing
// each other's queue; only the account's sync worker acknowledges those keys.
const LEGACY = 'pocket:travel-v2';
const ROOT = 'pocket:travel-store:';
const VIEW = Symbol('travel-rendered-baseline');
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const listeners = new Set();
const snapshots = new Map();
let running = null, runningAccount = '', rerun = false, live = false, poll = 0, soon = 0;
let sequence = 0, statusAccount = activeAccount();
export const status = { state: 'idle', last: 0, error: '', pending: 0, conflicts: 0, recovery: 0 };
const native = () => globalThis.localStorage;
const context = () => ({ accountId: activeAccount(), prefix: activeAccount() ? `pocket:account:${activeAccount()}:` : '' });
const current = ctx => activeAccount() === ctx.accountId;
const key = (ctx, suffix) => ctx.prefix + ROOT + suffix;
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`;
const read = (ctx, suffix) => { try { const value = JSON.parse(native().getItem(key(ctx, suffix)) || 'null'); return value?.accountId === ctx.accountId ? value : null; } catch { return null; } };
const write = (ctx, suffix, value) => native().setItem(key(ctx, suffix), JSON.stringify({ ...value, accountId: ctx.accountId }));
const remove = (ctx, suffix) => native().removeItem(key(ctx, suffix));
function entries(ctx, prefix) {
  const result = [], start = key(ctx, prefix);
  for (let index = 0; index < native().length; index++) {
    const name = native().key(index);
    if (!name?.startsWith(start)) continue;
    const suffix = name.slice(key(ctx, '').length), value = read(ctx, suffix);
    if (value) result.push({ ...value, _key: suffix });
  }
  return result;
}
const ops = ctx => entries(ctx, 'op:').sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
function alias(ctx, uid) {
  const seen = new Set();
  while (uid && !seen.has(uid)) { seen.add(uid); const next = read(ctx, 'alias:' + uid)?.uid; if (!next) break; uid = next; }
  return uid;
}
export const lookupAlias = uid => alias(context(), uid);
const forTrip = (ctx, uid) => ops(ctx).filter(op => alias(ctx, op.uid) === uid);
const pathConflicts = conflicts => (conflicts || []).map(conflict => typeof conflict === 'string' ? conflict : conflict.path || String(conflict));

// Old raw copies stay intact. Stable missing identifiers make importing the
// same pre-sharing trip on another device deterministic.
function hash(value) { let result = 2166136261; for (const char of String(value)) result = Math.imul(result ^ char.charCodeAt(0), 16777619); return (result >>> 0).toString(36); }
function legacyTrip(value, index) {
  const result = clone(value), seed = result?.uid || `legacy-${index}-${hash(canonical(value))}`;
  if (!result || typeof result !== 'object') return null;
  result.uid = VALID_ID.test(result.uid || '') ? result.uid : 'legacy-' + hash(seed); result.created ||= 1; result.updated ||= result.created;
  const items = (values, prefix) => (Array.isArray(values) ? values : []).map((item, position) => {
    const copy = typeof item === 'string' ? { text: item } : { ...item };
    copy.uid = VALID_ID.test(copy.uid || '') ? copy.uid : `${prefix.slice(0, 60)}-${position}-${hash(canonical(item))}`;
    if (prefix.includes('moment')) copy.created ||= result.created;
    return copy;
  });
  result.stops = items(result.stops, result.uid + '-stop').map(stop => ({ ...stop,
    activities: items(stop.activities, stop.uid + '-idea'), stays: items(stop.stays, stop.uid + '-stay'), moments: items(stop.moments, stop.uid + '-moment'),
  }));
  result.moments = items(result.moments, result.uid + '-moment');
  return normalizeTrip(result);
}
function append(ctx, operation, fixedId) {
  const id = fixedId || uuid();
  write(ctx, 'op:' + id, { ...operation, id, time: Date.now() });
  return id;
}
function ensure(ctx, starter) {
  if (read(ctx, 'initialized')) return;
  const raw = native().getItem(ctx.prefix + LEGACY);
  if (raw !== null && native().getItem(key(ctx, 'original-raw')) === null) native().setItem(key(ctx, 'original-raw'), raw);
  let values = [];
  if (raw !== null) {
    try {
      const doc = JSON.parse(raw);
      if (Array.isArray(doc?.trips)) values = doc.trips;
      else write(ctx, 'recovery:legacy-unreadable', { uid: 'legacy-unreadable', reason: 'The old travel file could not be interpreted. Download its original copy for recovery.', value: null, raw, operations: [], recoveredAt: Date.now() });
    } catch {
      write(ctx, 'recovery:legacy-unreadable', { uid: 'legacy-unreadable', reason: 'The old travel file could not be interpreted. Download its original copy for recovery.', value: null, raw, operations: [], recoveredAt: Date.now() });
    }
  }
  else if (starter) values = [starter];
  values.forEach((value, index) => {
    const trip = legacyTrip(value, index);
    if (!trip || index >= 80) {
      write(ctx, 'recovery:legacy-' + index, { uid: trip?.uid || value?.uid || 'legacy-' + index,
        reason: trip ? 'This older trip exceeds the 80-trip shelf limit. Its copy was kept for recovery.' : 'This older trip needs a valid title or format before it can be restored.',
        value: trip || clone(value), operations: [], recoveredAt: Date.now() });
      return;
    }
    if (value.uid && value.uid !== trip.uid) write(ctx, 'alias:' + value.uid, { uid: trip.uid });
    const id = 'migration-' + hash(trip.uid);
    if (!read(ctx, 'op:' + id) && !read(ctx, 'record:' + trip.uid)) append(ctx, { kind: 'create', uid: trip.uid, value: trip, migration: raw !== null }, id);
  });
  write(ctx, 'initialized', { v: 1 });
}
function compose(ctx, uid) {
  uid = alias(ctx, uid);
  const cached = read(ctx, 'record:' + uid), blocked = read(ctx, 'blocked:' + uid);
  if (blocked || cached?.deleted || cached?.accessible === false) return null;
  let value = cached?.value ? normalizeTrip(cached.value) : null, conflicts = [];
  const pending = forTrip(ctx, uid);
  for (const operation of pending) {
    if (operation.kind === 'delete' || operation.kind === 'leave') { value = null; continue; }
    const local = normalizeTrip({ ...operation.value, uid });
    if (!local) continue;
    if (!value) { value = local; continue; }
    if (operation.kind === 'create') continue;
    const base = operation.before && normalizeTrip({ ...operation.before, uid });
    if (!base) { value = local; continue; }
    const merged = mergeTrip(base, local, value);
    value = merged.value; conflicts.push(...(merged.conflicts || []));
  }
  const held = read(ctx, 'conflict:' + uid);
  // A refused deletion must remain discoverable on the shelf so its owner can
  // review the newer shared version and explicitly retry or cancel deletion.
  if (!value && held && cached?.value) value = clone(cached.value);
  if (!value && !pending.length) return null;
  return { ...(cached || {}), uid, value, role: cached?.role || 'owner', ownerId: cached?.ownerId || ctx.accountId,
    members: cached?.members || [], invites: cached?.invites || [], pending: pending.length > 0,
    conflict: held ? { ...held, local: value || held.local, remote: cached?.value ?? held.remote, paths: pathConflicts(held.conflicts) } : conflicts.length ? { conflicts, paths: pathConflicts(conflicts), local: value, remote: cached?.value, reason: 'Two local edits changed the same field.' } : null,
    offline: globalThis.navigator?.onLine === false, syncState: held || conflicts.length ? 'conflict' : pending.length ? 'pending' : 'synced',
  };
}
function visible(ctx) {
  const uids = new Set(entries(ctx, 'record:').map(record => record.uid));
  ops(ctx).forEach(op => uids.add(alias(ctx, op.uid)));
  return [...uids].map(uid => compose(ctx, uid)).filter(record => record?.value).sort((a, b) => Number(b.value.created || 0) - Number(a.value.created || 0) || a.uid.localeCompare(b.uid));
}
function remember(trip) {
  const value = clone(trip);
  snapshots.set(`${activeAccount()}:${trip.uid}:${trip.updated}`, value);
  if (snapshots.size > 300) snapshots.delete(snapshots.keys().next().value);
  Object.defineProperty(trip, VIEW, { value, enumerable: true });
  return trip;
}
export function readTrips(starter) { const ctx = context(); ensure(ctx, starter); return visible(ctx).map(record => remember(clone(record.value))); }
export function getRecord(uid) { const ctx = context(); ensure(ctx); const record = compose(ctx, uid); if (!record) return null; return { ...clone(record), value: record.value ? remember(clone(record.value)) : null }; }
export function recoveryEntries() { const ctx = context(); return entries(ctx, 'recovery:').map(({ _key, ...entry }) => entry); }
/** Restore recovery artifacts only; their contents never enter the upload queue. */
export function importRecoveryEntries(values) {
  const ctx = context();
  if (!Array.isArray(values) || values.length > 500 || entries(ctx, 'recovery:').length + values.length > 1000) throw new Error('Restore up to 500 recovery copies at a time.');
  const serialized = JSON.stringify(values);
  if (new TextEncoder().encode(serialized).length > 16 * 1024 * 1024) throw new Error('Recovery copies must fit within 16 MB.');
  const prepared = values.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('This backup contains an invalid recovery copy.');
    if (value.raw !== undefined && typeof value.raw !== 'string') throw new Error('This backup contains an invalid original travel file.');
    if (value.operations !== undefined && !Array.isArray(value.operations)) throw new Error('This backup contains invalid saved travel edits.');
    return { uid: typeof value.uid === 'string' ? value.uid.slice(0, 500) : 'restored-' + uuid(),
      reason: typeof value.reason === 'string' ? value.reason.slice(0, 2000) : 'A recovery copy restored from a Pocket backup.',
      value: clone(value.value ?? null), operations: clone(value.operations || []), recoveredAt: Date.now(),
      ...(value.raw !== undefined ? { raw: value.raw } : {}),
    };
  });
  prepared.forEach(value => write(ctx, 'recovery:restored-' + uuid(), value));
  emit(); return prepared.length;
}
export function pendingCount() { const ctx = context(); return ctx.accountId ? ops(ctx).length : 0; }
export function readStatus() {
  const ctx = context();
  if (statusAccount !== ctx.accountId) {
    statusAccount = ctx.accountId;
    Object.assign(status, { state: 'idle', last: 0, error: '', pending: 0, conflicts: 0, recovery: 0 });
  }
  const conflicts = new Set(entries(ctx, 'conflict:').map(entry => entry.uid));
  visible(ctx).filter(record => record.conflict).forEach(record => conflicts.add(record.uid));
  return { ...status, last: read(ctx, 'status')?.last || 0, accountId: ctx.accountId, pending: ctx.accountId ? ops(ctx).length : 0,
    conflicts: conflicts.size, recovery: entries(ctx, 'recovery:').length };
}
export function subscribe(callback) { listeners.add(callback); return () => listeners.delete(callback); }
function emit(persist = false) {
  const next = readStatus(); Object.assign(status, next);
  listeners.forEach(callback => { try { callback(next); } catch (error) { console.error(error); } });
  if (persist) globalThis.dispatchEvent?.(new Event('pocket-persistence-change'));
}
function guestMirror(ctx) { if (!ctx.accountId) native().setItem(LEGACY, JSON.stringify({ v: 2, trips: visible(ctx).map(record => record.value) })); }
function schedule() {
  clearTimeout(soon);
  if (running && runningAccount === context().accountId) { rerun = true; return; }
  if (context().accountId) soon = setTimeout(() => syncTravel(), 400);
}
export function saveTrip(value, editBase) {
  const ctx = context(); ensure(ctx);
  const uid = alias(ctx, value?.uid || uuid()), prior = compose(ctx, uid);
  if (read(ctx, 'blocked:' + uid) || read(ctx, 'record:' + uid)?.deleted) throw new Error('This trip is no longer available. Your saved recovery copy is kept on this device.');
  if (prior?.role === 'viewer') throw new Error('You can view this trip. Ask its owner for editing access.');
  if (!prior && visible(ctx).length >= 80) throw new Error('The travel shelf holds up to 80 trips.');
  const trip = normalizeTrip({ ...value, uid, updated: Math.max(Date.now(), Number(value?.updated || 0) + 1), created: value?.created || Date.now() });
  if (!trip) throw new Error('Add a trip name before saving.');
  const before = editBase || value?.[VIEW] || snapshots.get(`${ctx.accountId}:${value?.uid}:${value?.updated}`) || prior?.value;
  append(ctx, prior ? { kind: 'edit', uid, before: before ? { ...clone(before), uid } : null, value: trip } : { kind: 'create', uid, value: trip, migration: false });
  guestMirror(ctx); emit(true); schedule();
  return remember(clone(compose(ctx, uid)?.value || trip));
}
export function deleteTrip(uid, baseRevision) {
  const ctx = context(); ensure(ctx); uid = alias(ctx, uid);
  const record = compose(ctx, uid); if (!record) return false;
  if (record.role !== 'owner') throw new Error('Only the trip owner can delete this trip.');
  append(ctx, { kind: 'delete', uid, before: record.value, baseRevision: baseRevision ?? record.revision });
  guestMirror(ctx); emit(true); schedule(); return true;
}

class AccountChanged extends Error { constructor() { super('The active account changed.'); } }
class TravelError extends Error { constructor(message, code, body) { super(message); this.code = code; this.body = body; } }
async function request(ctx, body, query = '') {
  if (!current(ctx)) throw new AccountChanged();
  if (body && (!ctx.accountId || !cloud.connected())) throw new Error('Sign in to share or sync a trip.');
  const response = await fetch('/api/travel' + query, { credentials: 'same-origin', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, accountId: ctx.accountId }) } : {}) });
  let result; try { result = await response.json(); } catch { throw new Error('Travel sync returned an unreadable response.'); }
  if (!current(ctx)) throw new AccountChanged();
  if (result.accountId !== undefined && result.accountId !== ctx.accountId) throw new AccountChanged();
  if (response.status === 401 && cloud.init) {
    // Reconcile the shared auth module as well as Travel's local status.
    try { await cloud.init(); } catch { /* keep the original API error */ }
    if (!current(ctx)) throw new AccountChanged();
  }
  if (!response.ok) throw new TravelError(result.error || result.message || 'Travel sync failed.', response.status, result);
  return result;
}
function putRecord(ctx, record) {
  if (!record?.uid) throw new Error('Travel sync returned an incomplete trip.');
  const existing = read(ctx, 'record:' + record.uid);
  if (existing && Number(existing.revision) > Number(record.revision)) return;
  write(ctx, 'record:' + record.uid, { ...record, accessible: true });
}
function acknowledge(ctx, operations) { operations.forEach(op => remove(ctx, op._key || 'op:' + op.id)); }
function recover(ctx, uid, reason, operations = forTrip(ctx, uid), local) {
  const record = compose(ctx, uid), saved = local || record?.value || [...operations].reverse().find(op => op.value)?.value || record?.value;
  if (operations.length || local) write(ctx, 'recovery:' + uid + ':' + uuid(), { uid, reason, value: clone(saved), operations: clone(operations), recoveredAt: Date.now() });
  acknowledge(ctx, operations); remove(ctx, 'conflict:' + uid);
  remove(ctx, 'flight:' + uid);
  write(ctx, 'blocked:' + uid, { uid, reason });
  const cached = read(ctx, 'record:' + uid); if (cached) write(ctx, 'record:' + uid, { ...cached, value: null, accessible: false });
}
function holdConflict(ctx, uid, record, local, conflicts, reason) {
  if (record) putRecord(ctx, record);
  write(ctx, 'conflict:' + uid, { uid, local: clone(local), remote: clone(record?.value), conflicts: clone(conflicts || []),
    intent: forTrip(ctx, uid).some(op => op.kind === 'delete') ? 'delete' : 'edit', reason: reason || 'Choose which change to keep.', createdAt: Date.now() });
}
async function fetchRecords(ctx) {
  const result = await request(ctx);
  if (!Array.isArray(result.records)) throw new Error('Travel sync returned an incomplete library.');
  const accessible = new Set(result.records.map(record => record.uid));
  for (const record of result.records) {
    const old = read(ctx, 'record:' + record.uid);
    if (record.deleted || !record.value) {
      const pending = forTrip(ctx, record.uid);
      if (pending.length) recover(ctx, record.uid, 'The owner deleted this trip. Unsynced edits are kept for recovery.', pending);
      putRecord(ctx, record); continue;
    }
    remove(ctx, 'blocked:' + record.uid);
    const pending = forTrip(ctx, record.uid);
    if (record.role === 'viewer' && pending.some(op => op.kind === 'edit' || op.kind === 'delete')) {
      recover(ctx, record.uid, 'Editing access was removed. Unsynced edits are kept for recovery.', pending);
      remove(ctx, 'blocked:' + record.uid);
    }
    // Rebasing later in compose preserves fields changed while GET was in flight.
    putRecord(ctx, record);
    if (old?.revision !== record.revision) snapshots.delete(`${ctx.accountId}:${record.uid}:${record.value.updated}`);
  }
  for (const cached of entries(ctx, 'record:')) {
    if (accessible.has(cached.uid) || cached.deleted || cached.accessible === false) continue;
    recover(ctx, cached.uid, 'This trip is no longer shared with this account. Unsynced edits are kept for recovery.');
  }
}
async function syncOne(ctx, uid) {
  let pending = forTrip(ctx, uid); if (!pending.length || read(ctx, 'conflict:' + uid) || read(ctx, 'blocked:' + uid)) return;
  let cached = read(ctx, 'record:' + uid);
  const creating = pending.find(op => op.kind === 'create');
  if (!cached && creating) {
    const result = await request(ctx, { action: 'create', localUid: creating.uid, value: creating.value, mutationId: creating.id });
    const record = result.record;
    if (!record?.uid) throw new Error('Travel sync returned an incomplete trip.');
    write(ctx, 'alias:' + creating.uid, { uid: record.uid });
    putRecord(ctx, record); acknowledge(ctx, [creating]);
    const imported = normalizeTrip({ ...creating.value, uid: record.uid });
    if (record.deleted || !record.value) {
      const remaining = forTrip(ctx, record.uid);
      recover(ctx, record.uid, 'An older copy of a deleted trip was found. It was kept for recovery.', remaining, imported);
      return;
    }
    if (result.created === false && canonical(imported) !== canonical(record.value)) {
      write(ctx, 'recovery:' + record.uid + ':' + uuid(), { uid: record.uid, reason: 'An older imported copy differs from the shared trip. The shared trip was kept.', value: imported, operations: [creating], recoveredAt: Date.now() });
      const following = forTrip(ctx, record.uid);
      if (following.length) recover(ctx, record.uid, 'Edits to an older imported copy need manual recovery.', following);
      remove(ctx, 'blocked:' + record.uid);
      putRecord(ctx, record);
    }
    uid = record.uid; cached = read(ctx, 'record:' + uid); pending = forTrip(ctx, uid);
  }
  if (!pending.length) return;
  if (!cached || cached.accessible === false || cached.deleted) { recover(ctx, uid, 'The shared trip is no longer available.', pending); return; }
  const final = pending[pending.length - 1], deleting = pending.some(op => op.kind === 'delete'), leaving = pending.some(op => op.kind === 'leave');
  const local = compose(ctx, uid);
  let flight = read(ctx, 'flight:' + uid);
  if (!flight && local?.conflict && !deleting && !leaving) { holdConflict(ctx, uid, cached, local.value, local.conflict.conflicts, local.conflict.reason); return; }
  if (!flight) {
    const deletion = pending.find(op => op.kind === 'delete');
    flight = { operations: pending.map(op => op.id), local: clone(local?.value), request: { action: leaving ? 'leave' : deleting ? 'delete' : 'sync', uid,
      baseRevision: deleting ? deletion.baseRevision ?? cached.revision : cached.revision, ...(!deleting && !leaving ? { value: local.value } : {}), mutationId: final.id } };
    write(ctx, 'flight:' + uid, flight);
  }
  const sent = pending.filter(op => flight.operations.includes(op.id));
  try {
    const result = await request(ctx, flight.request);
    if (flight.request.action === 'leave') { acknowledge(ctx, sent); recover(ctx, uid, 'You left this trip.', [], null); }
    else {
      putRecord(ctx, result.record); acknowledge(ctx, sent); remove(ctx, 'conflict:' + uid); remove(ctx, 'flight:' + uid);
      if (result.record?.deleted && forTrip(ctx, uid).length) recover(ctx, uid, 'This trip was deleted while another edit was being saved.');
    }
  } catch (error) {
    if (error.code === 409 && error.body?.record) {
      remove(ctx, 'flight:' + uid);
      holdConflict(ctx, uid, error.body.record, local?.value || [...pending].reverse().find(op => op.value || op.before)?.value || final.before, error.body.conflicts, error.message); return;
    }
    if (error.code === 403 || error.code === 404 || error.code === 410) { recover(ctx, uid, error.message || 'Trip access was removed.'); return; }
    throw error;
  }
}
async function synchronize(ctx) {
  if (!current(ctx) || !ctx.accountId) return false;
  if (globalThis.navigator?.onLine === false) { status.state = 'offline'; emit(); return false; }
  if (!cloud.connected()) { status.state = 'signed-out'; emit(); return false; }
  const before = canonical(visible(ctx).map(record => record.value));
  status.state = 'syncing'; status.error = ''; emit();
  try {
    await fetchRecords(ctx);
    const uids = [...new Set(ops(ctx).map(op => alias(ctx, op.uid)))];
    for (const uid of uids) { if (!current(ctx)) throw new AccountChanged(); await syncOne(ctx, uid); }
    // Catch writes made during a request on the next coalesced pass.
    status.last = Date.now(); write(ctx, 'status', { last: status.last });
    status.state = readStatus().conflicts ? 'conflict' : 'idle';
    return before !== canonical(visible(ctx).map(record => record.value));
  } catch (error) {
    if (error instanceof AccountChanged) return false;
    status.state = globalThis.navigator?.onLine === false ? 'offline' : error.code === 401 ? 'signed-out' : 'error';
    status.error = error.message || 'Travel sync failed.'; return false;
  } finally { if (current(ctx)) emit(); }
}
export function syncTravel() {
  const ctx = context(); ensure(ctx);
  if (!ctx.accountId) { status.state = 'local'; emit(); return Promise.resolve(false); }
  if (running) {
    if (runningAccount !== ctx.accountId) return running.then(() => syncTravel());
    rerun = true; return running;
  }
  runningAccount = ctx.accountId;
  running = (async () => {
    let changed = false;
    const work = async () => {
      do { rerun = false; changed = await synchronize(ctx) || changed; } while (rerun && current(ctx) && status.state !== 'error' && status.state !== 'offline' && status.state !== 'signed-out');
      return changed;
    };
    // Web Locks also serialize manual sync and polling across browser tabs.
    if (globalThis.navigator?.locks?.request) return navigator.locks.request('pocket-travel-sync:' + ctx.accountId, work);
    return work();
  })().finally(() => { running = null; });
  return running;
}
function updatePolling() {
  clearInterval(poll); poll = 0;
  if (!live || globalThis.document?.visibilityState === 'hidden') return;
  syncTravel(); poll = setInterval(() => syncTravel(), 5000);
}
export function startLive() { live = true; updatePolling(); }
export function stopLive() { live = false; clearInterval(poll); poll = 0; }

async function shareAction(action, uid, details = {}) {
  const ctx = context(); ensure(ctx);
  await syncTravel();
  if (!current(ctx)) throw new AccountChanged();
  uid = alias(ctx, uid);
  const record = compose(ctx, uid);
  if (!record?.value || record.pending) throw new Error('Sync this trip before changing sharing.');
  if (record.role !== 'owner' && action !== 'leave') throw new Error('Only the trip owner can change sharing.');
  try {
    const result = await request(ctx, { action, uid, ...details, mutationId: uuid() });
    if (result.record) putRecord(ctx, result.record);
    if (action === 'leave') recover(ctx, uid, 'You left this trip.', []);
    emit(); return result;
  } catch (error) {
    if (error.code === 403 || error.code === 404) { await fetchRecords(ctx); emit(); }
    throw error;
  }
}
export const inviteTrip = (uid, email = '', role = 'editor') => shareAction('invite', uid, { email, role });
export const removeMember = (uid, userId) => shareAction('remove', uid, { userId });
export const revokeInvite = (uid, inviteId) => shareAction('revoke', uid, { inviteId });
export const leaveTrip = uid => shareAction('leave', uid);
export async function previewInvite(token) { const result = await request(context(), null, '?invite=' + encodeURIComponent(token)); return result.invite; }
export async function acceptInvite(token) {
  const ctx = context();
  const result = await request(ctx, { action: 'accept', token, mutationId: uuid() });
  if (result.record) { remove(ctx, 'blocked:' + result.record.uid); putRecord(ctx, result.record); }
  emit(); return result.record;
}
export function resolveConflict(uid, choice) {
  const ctx = context(); ensure(ctx); uid = alias(ctx, uid);
  if (!['local', 'remote'].includes(choice)) throw new Error('Choose the local or shared version.');
  const held = read(ctx, 'conflict:' + uid) || compose(ctx, uid)?.conflict, record = read(ctx, 'record:' + uid);
  if (!held || !record?.value) return false;
  const pending = forTrip(ctx, uid), local = compose(ctx, uid)?.value || held.local;
  let chosen = local;
  if (choice === 'remote') {
    chosen = clone(record.value);
    for (const operation of pathConflicts(held.conflicts).includes('limits') ? [] : pending) {
      if (operation.kind !== 'edit' || !operation.before || !operation.value) continue;
      // Reversing merge preference chooses the shared side only on conflicts;
      // unrelated local changes still enter the merged value.
      const before = normalizeTrip({ ...operation.before, uid }), incoming = normalizeTrip({ ...operation.value, uid });
      chosen = mergeTrip(before, chosen, incoming).value;
    }
  }
  // Append the decision before removing prior keys, so a failed local write
  // cannot erase the unsaved version. Fresh operations from other tabs remain.
  if (choice === 'local') {
    if (pending.some(op => op.kind === 'delete')) append(ctx, { kind: 'delete', uid, before: record.value, baseRevision: record.revision });
    else append(ctx, { kind: 'edit', uid, before: record.value, value: chosen });
  }
  else if (chosen && canonical(chosen) !== canonical(record.value)) append(ctx, { kind: 'edit', uid, before: record.value, value: chosen });
  acknowledge(ctx, pending); remove(ctx, 'conflict:' + uid);
  remove(ctx, 'flight:' + uid);
  emit(true); schedule(); return true;
}

globalThis.addEventListener?.('storage', event => {
  const ctx = context();
  if (event.key === 'pocket:active-account') { stopLive(); snapshots.clear(); Object.assign(status, { state: 'idle', last: 0, error: '' }); emit(); return; }
  if (event.key?.startsWith(key(ctx, ''))) { emit(); if (live && event.key.startsWith(key(ctx, 'op:'))) schedule(); }
});
globalThis.addEventListener?.('online', () => { emit(); if (context().accountId) syncTravel(); });
globalThis.addEventListener?.('offline', () => { status.state = 'offline'; emit(); });
globalThis.addEventListener?.('focus', () => { if (context().accountId) syncTravel(); });
globalThis.document?.addEventListener?.('visibilitychange', updatePolling);
