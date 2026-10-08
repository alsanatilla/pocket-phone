import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { database, ensureSchema, writeTransaction } from './database.js';
import { canonical, mergeTrip, normalizeTrip } from '../shared/travel-data.js';

const MAX_BYTES = 1024 * 1024;
const UID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const CURRENCIES = ['EUR', 'USD', 'PEN', 'BOB', 'CLP', 'BRL'];
const STATUSES = ['idea', 'shortlist', 'booked', 'included'];
const MODES = ['flight', 'train', 'bus', 'ferry', 'transfer', 'tour', 'other'];
const KINDS = ['hotel', 'guesthouse', 'apartment', 'hostel', 'tour', 'camp', 'other'];
const MOMENTS = ['detour', 'taste', 'sound', 'person', 'tiny', 'weather', 'other'];
const DAY_MS = 24 * 60 * 60 * 1000;
const invalid = message => Object.assign(new Error(message), { status: 400 });
const denied = () => Object.assign(new Error('This trip is not available to your account.'), { status: 404 });
const conflict = (message, record, conflicts = []) => Object.assign(new Error(message), { status: 409, record, conflicts });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const hash = value => createHash('sha256').update(value).digest('hex');

const TABLES = [
  `CREATE TABLE IF NOT EXISTS pocket_travel (uid TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, local_uid TEXT NOT NULL, payload TEXT, revision INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL, UNIQUE(owner_id, local_uid))`,
  `CREATE INDEX IF NOT EXISTS pocket_travel_owner ON pocket_travel(owner_id)`,
  `CREATE TABLE IF NOT EXISTS pocket_travel_members (trip_uid TEXT NOT NULL REFERENCES pocket_travel(uid) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('owner','editor','viewer')), PRIMARY KEY(trip_uid, user_id))`,
  `CREATE INDEX IF NOT EXISTS pocket_travel_member_user ON pocket_travel_members(user_id)`,
  `CREATE TABLE IF NOT EXISTS pocket_travel_history (trip_uid TEXT NOT NULL REFERENCES pocket_travel(uid) ON DELETE CASCADE, revision INTEGER NOT NULL, payload TEXT, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(trip_uid, revision))`,
  `CREATE TABLE IF NOT EXISTS pocket_travel_invites (id TEXT PRIMARY KEY, trip_uid TEXT NOT NULL REFERENCES pocket_travel(uid) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE, email TEXT NOT NULL DEFAULT '', role TEXT NOT NULL CHECK(role IN ('editor','viewer')), expires_at INTEGER NOT NULL, accepted_by TEXT, accepted_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS pocket_travel_invite_trip ON pocket_travel_invites(trip_uid)`,
  `CREATE TABLE IF NOT EXISTS pocket_travel_mutations (user_id TEXT NOT NULL REFERENCES pocket_user(id) ON DELETE CASCADE, mutation_id TEXT NOT NULL, request_hash TEXT NOT NULL, trip_uid TEXT NOT NULL REFERENCES pocket_travel(uid) ON DELETE CASCADE, action TEXT NOT NULL, PRIMARY KEY(user_id, mutation_id))`,
];
let initializing;
export function ensureTravelSchema() {
  if (!initializing) initializing = ensureSchema().then(() => database().batch(TABLES, 'write')).catch(error => { initializing = null; throw error; });
  return initializing;
}

function object(value, keys, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid(`Invalid ${path}.`);
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw invalid(`Unknown ${path} field.`);
}
function text(value, limit, path, required = false) {
  if (value === undefined && !required) return;
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || required && !value.trim()) throw invalid(`Invalid ${path}.`);
}
function uid(value, path = 'trip ID') { if (typeof value !== 'string' || !UID.test(value)) throw invalid(`Invalid ${path}.`); }
function enumField(value, options, path) { if (value !== undefined && !options.includes(value)) throw invalid(`Invalid ${path}.`); }
function number(value, max, path, empty = false) {
  if (value === undefined || empty && value === '') return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw invalid(`Invalid ${path}.`);
}
function timestamp(value, path) { if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw invalid(`Invalid ${path}.`); }
function day(value, path) {
  if (value === undefined || value === '') return;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid(`Invalid ${path}.`);
  const date = new Date(value + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw invalid(`Invalid ${path}.`);
}
function url(value, path) {
  if (value === undefined || value === '') return;
  text(value, 2048, path);
  try { if (!['https:', 'http:'].includes(new URL(value).protocol)) throw new Error(); }
  catch { throw invalid(`Use an HTTP or HTTPS link for ${path}.`); }
}
function strings(value, fields, path) { for (const [key, limit] of Object.entries(fields)) text(value[key], limit, `${path}.${key}`); }
function dates(value, fields, path) { for (const key of fields) day(value[key], `${path}.${key}`); }
function array(value, max, validate, path) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > max) throw invalid(`Invalid ${path}.`);
  const used = new Set();
  for (const item of value) {
    validate(item, path);
    if (used.has(item.uid)) throw invalid(`Duplicate ID in ${path}.`);
    used.add(item.uid);
  }
}
function connection(value, path, returning = false) {
  if (value === undefined) return;
  object(value, ['label', 'date', 'url', 'cost', 'currency', 'status', 'reference', ...(returning ? [] : ['mode'])], path);
  strings(value, { label: returning ? 240 : 160, reference: 120 }, path);
  day(value.date, `${path}.date`); url(value.url, `${path}.url`); number(value.cost, 1e9, `${path}.cost`, true);
  enumField(value.currency, CURRENCIES, `${path}.currency`); enumField(value.status, STATUSES, `${path}.status`);
  if (!returning) enumField(value.mode, MODES, `${path}.mode`);
}
function stay(value, path) {
  object(value, ['uid', 'name', 'kind', 'url', 'rating', 'status', 'nightlyCost', 'totalCost', 'currency', 'checkIn', 'checkOut', 'cancelBy', 'bookingRef', 'address', 'note'], path);
  uid(value.uid, `${path}.uid`); text(value.name, 140, `${path}.name`, true);
  strings(value, { bookingRef: 120, address: 240, note: 800 }, path); dates(value, ['checkIn', 'checkOut', 'cancelBy'], path); url(value.url, `${path}.url`);
  enumField(value.kind, KINDS, `${path}.kind`); enumField(value.status, STATUSES, `${path}.status`); enumField(value.currency, CURRENCIES, `${path}.currency`);
  number(value.rating, 5, `${path}.rating`); number(value.nightlyCost, 1e9, `${path}.nightlyCost`, true); number(value.totalCost, 1e9, `${path}.totalCost`, true);
}
function activity(value, path) {
  object(value, ['uid', 'text', 'done', 'optional'], path); uid(value.uid, `${path}.uid`); text(value.text, 240, `${path}.text`, true);
  for (const key of ['done', 'optional']) if (value[key] !== undefined && typeof value[key] !== 'boolean') throw invalid(`Invalid ${path}.${key}.`);
}
function moment(value, path) {
  object(value, ['uid', 'kind', 'title', 'detail', 'day', 'created'], path); uid(value.uid, `${path}.uid`); text(value.title, 240, `${path}.title`, true);
  text(value.detail, 600, `${path}.detail`); enumField(value.kind, MOMENTS, `${path}.kind`); day(value.day, `${path}.day`); timestamp(value.created, `${path}.created`);
}
function stop(value, path) {
  object(value, ['uid', 'place', 'country', 'arrival', 'departure', 'nights', 'currency', 'guidance', 'activities', 'stays', 'moments', 'connection'], path);
  uid(value.uid, `${path}.uid`); text(value.place, 140, `${path}.place`, true); strings(value, { country: 80, guidance: 700 }, path);
  dates(value, ['arrival', 'departure'], path); number(value.nights, 90, `${path}.nights`); enumField(value.currency, CURRENCIES, `${path}.currency`);
  array(value.activities, 60, activity, `${path}.activities`); array(value.stays, 20, stay, `${path}.stays`); array(value.moments, 100, moment, `${path}.moments`);
  connection(value.connection, `${path}.connection`);
}
export function validateTravelTrip(value) {
  object(value, ['uid', 'title', 'status', 'departure', 'returnDate', 'homeArrival', 'homeCity', 'countries', 'travelers', 'currency', 'budget', 'intention', 'returnPlan', 'returnJourney', 'stops', 'moments', 'created', 'updated'], 'trip');
  uid(value.uid); text(value.title, 100, 'trip.title', true);
  strings(value, { homeCity: 100, countries: 180, travelers: 160, intention: 900, returnPlan: 900 }, 'trip');
  dates(value, ['departure', 'returnDate', 'homeArrival'], 'trip'); enumField(value.status, ['draft', 'active', 'done'], 'trip.status'); enumField(value.currency, CURRENCIES, 'trip.currency');
  number(value.budget, 1e9, 'trip.budget', true); timestamp(value.created, 'trip.created'); timestamp(value.updated, 'trip.updated');
  array(value.stops, 80, stop, 'trip.stops'); array(value.moments, 100, moment, 'trip.moments'); connection(value.returnJourney, 'trip.returnJourney', true);
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw Object.assign(new Error('This trip is too large to sync.'), { status: 413 });
  const normalized = normalizeTrip(value);
  if (!normalized) throw invalid('Invalid trip.');
  return normalized;
}

async function accessible(db, userId, tripId, allowDeleted = false) {
  const rows = await db.execute({ sql: 'SELECT t.*, m.role FROM pocket_travel t JOIN pocket_travel_members m ON m.trip_uid = t.uid WHERE t.uid = ? AND m.user_id = ?', args: [tripId, userId] });
  const row = rows.rows[0];
  if (!row || !allowDeleted && Number(row.deleted)) throw denied();
  return row;
}
function requireOwner(row) { if (row.role !== 'owner') throw Object.assign(new Error('Only the trip owner can do that.'), { status: 403 }); }
function requireEditor(row) { if (!['owner', 'editor'].includes(row.role)) throw Object.assign(new Error('This trip is shared with view access.'), { status: 403 }); }
const inviteDTO = row => ({ id: String(row.id), email: String(row.email), role: String(row.role), expiresAt: Number(row.expires_at) });

// Recheck membership rather than trusting a role supplied by a caller or a previous response.
export async function metadataDTO(userId, row, db = database()) {
  row = await accessible(db, userId, String(row.uid), true);
  const members = await db.execute({ sql: 'SELECT m.user_id, m.role, u.name, u.email FROM pocket_travel_members m JOIN pocket_user u ON u.id = m.user_id WHERE m.trip_uid = ? ORDER BY CASE m.role WHEN \'owner\' THEN 0 WHEN \'editor\' THEN 1 ELSE 2 END, u.name, m.user_id', args: [String(row.uid)] });
  const record = {
    uid: String(row.uid), value: Number(row.deleted) ? null : JSON.parse(String(row.payload)), revision: Number(row.revision), role: String(row.role), ownerId: String(row.owner_id),
    members: members.rows.map(member => ({ userId: String(member.user_id), name: String(member.name), email: String(member.email), role: String(member.role) })),
    updatedBy: String(row.updated_by), updatedAt: Number(row.updated_at), ...(Number(row.deleted) ? { deleted: true } : {}),
  };
  if (row.role === 'owner') {
    const invites = await db.execute({ sql: 'SELECT id, email, role, expires_at FROM pocket_travel_invites WHERE trip_uid = ? AND revoked = 0 AND accepted_by IS NULL AND expires_at > ? ORDER BY expires_at', args: [String(row.uid), Date.now()] });
    record.invites = invites.rows.map(inviteDTO);
  }
  return record;
}
export async function readTravel(userId) {
  await ensureTravelSchema();
  // A consistent read snapshot covers the authorization and member metadata together.
  const tx = await database().transaction('read');
  try {
    const rows = await tx.execute({ sql: 'SELECT t.uid FROM pocket_travel t JOIN pocket_travel_members m ON m.trip_uid = t.uid WHERE m.user_id = ? ORDER BY t.updated_at DESC, t.uid', args: [userId] });
    const records = [];
    for (const row of rows.rows) records.push(await metadataDTO(userId, row, tx));
    await tx.commit(); return records;
  } catch (error) { await tx.rollback().catch(() => {}); throw error; }
  finally { tx.close(); }
}

async function writeVersion(tx, row, value, userId, deleted = false) {
  const revision = Number(row.revision) + 1, updatedAt = Date.now(), payload = deleted ? null : JSON.stringify(value);
  await tx.execute({ sql: 'UPDATE pocket_travel SET payload = ?, revision = ?, deleted = ?, updated_at = ?, updated_by = ? WHERE uid = ? AND revision = ?', args: [payload, revision, deleted ? 1 : 0, updatedAt, userId, String(row.uid), Number(row.revision)] });
  await tx.execute({ sql: 'INSERT INTO pocket_travel_history (trip_uid, revision, payload, deleted) VALUES (?, ?, ?, ?)', args: [String(row.uid), revision, payload, deleted ? 1 : 0] });
}
function revision(value) { if (!Number.isSafeInteger(value) || value < 1) throw invalid('Invalid trip revision.'); }
function email(value) {
  if (value === undefined || value === '') return '';
  text(value, 254, 'invitation email', true);
  const normalized = value.trim().toLowerCase(); if (!EMAIL.test(normalized)) throw invalid('Enter a valid email address.'); return normalized;
}
function token(value) { if (typeof value !== 'string' || !TOKEN.test(value)) throw invalid('This invitation link is invalid.'); }
async function replay(tx, userId, body, requestHash) {
  const result = await tx.execute({ sql: 'SELECT * FROM pocket_travel_mutations WHERE user_id = ? AND mutation_id = ?', args: [userId, body.mutationId] });
  const row = result.rows[0];
  if (!row) return null;
  if (row.action !== body.action) throw conflict('This change ID has already been used.');
  const trip = await accessible(tx, userId, String(row.trip_uid), true);
  if (body.action === 'delete' || body.action === 'create') requireOwner(trip); else requireEditor(trip);
  // The same legacy import can arrive from several devices with the same
  // deterministic migration ID and different stale contents. Its stable local
  // identity still resolves to the first canonical trip, without overwriting it.
  if (row.request_hash !== requestHash && !(body.action === 'create' && String(trip.local_uid) === body.localUid)) throw conflict('This change ID has already been used.');
  return { record: await metadataDTO(userId, trip, tx), ...(body.action === 'create' ? { created: false, localUid: body.localUid } : {}) };
}
async function remember(tx, userId, body, requestHash, tripId) {
  await tx.execute({ sql: 'INSERT INTO pocket_travel_mutations (user_id, mutation_id, request_hash, trip_uid, action) VALUES (?, ?, ?, ?, ?)', args: [userId, body.mutationId, requestHash, tripId, body.action] });
}

export async function mutateTravel(user, body) {
  object(body, ['accountId', 'action', 'uid', 'localUid', 'value', 'baseRevision', 'mutationId', 'email', 'role', 'token', 'inviteId', 'userId'], 'travel request');
  if (body.accountId !== user.id) throw conflict('Account changed. Reload Pocket.');
  enumField(body.action, ['create', 'sync', 'delete', 'leave', 'invite', 'accept', 'revoke', 'remove'], 'travel action');
  if (!body.action) throw invalid('Choose a travel action.');
  const mutations = ['create', 'sync', 'delete'].includes(body.action);
  if (mutations) uid(body.mutationId, 'change ID');
  // Hash the request before tolerant normalization supplies timestamps, so an
  // identical retry remains identical even when optional local metadata was absent.
  const requestHash = mutations ? hash(canonical(body)) : null;
  if (body.action === 'create') { uid(body.localUid, 'local trip ID'); body = { ...body, value: validateTravelTrip(body.value) }; }
  else if (body.action !== 'accept') uid(body.uid);
  if (body.action === 'sync') { revision(body.baseRevision); body = { ...body, value: validateTravelTrip(body.value) }; if (body.value.uid !== body.uid) throw invalid('Trip IDs do not match.'); }
  if (body.action === 'delete') revision(body.baseRevision);
  if (body.action === 'invite') { enumField(body.role, ['editor', 'viewer'], 'invitation role'); if (!body.role) throw invalid('Choose an invitation role.'); body = { ...body, email: email(body.email) }; }
  if (body.action === 'accept') token(body.token);
  if (body.action === 'revoke') uid(body.inviteId, 'invitation ID');
  if (body.action === 'remove') text(body.userId, 250, 'member ID', true);
  await ensureTravelSchema();
  return writeTransaction(async tx => {
    if (mutations) { const existing = await replay(tx, user.id, body, requestHash); if (existing) return existing; }
    if (body.action === 'create') {
      const previous = await tx.execute({ sql: 'SELECT * FROM pocket_travel WHERE owner_id = ? AND local_uid = ?', args: [user.id, body.localUid] });
      if (previous.rows[0]) {
        const row = await accessible(tx, user.id, String(previous.rows[0].uid), true); requireOwner(row);
        await remember(tx, user.id, body, requestHash, String(row.uid));
        return { record: await metadataDTO(user.id, row, tx), created: false, localUid: body.localUid };
      }
      const count = await tx.execute({ sql: 'SELECT COUNT(*) AS total FROM pocket_travel WHERE owner_id = ? AND deleted = 0', args: [user.id] });
      if (Number(count.rows[0].total) >= 80) throw invalid('The travel shelf holds up to 80 trips.');
      const tripId = randomUUID(), value = { ...body.value, uid: tripId }, payload = JSON.stringify(value), now = Date.now();
      await tx.execute({ sql: 'INSERT INTO pocket_travel (uid, owner_id, local_uid, payload, revision, updated_at, updated_by) VALUES (?, ?, ?, ?, 1, ?, ?)', args: [tripId, user.id, body.localUid, payload, now, user.id] });
      await tx.execute({ sql: 'INSERT INTO pocket_travel_members (trip_uid, user_id, role) VALUES (?, ?, \'owner\')', args: [tripId, user.id] });
      await tx.execute({ sql: 'INSERT INTO pocket_travel_history (trip_uid, revision, payload) VALUES (?, 1, ?)', args: [tripId, payload] });
      await remember(tx, user.id, body, requestHash, tripId);
      return { record: await metadataDTO(user.id, { uid: tripId }, tx), created: true, localUid: body.localUid };
    }
    if (body.action === 'accept') return acceptInvite(tx, user, body.token);
    const row = await accessible(tx, user.id, body.uid, ['sync', 'delete'].includes(body.action));
    if (body.action === 'sync') {
      requireEditor(row);
      if (Number(row.deleted)) throw conflict('This trip was deleted. Keep a copy of your changes before dismissing it.', await metadataDTO(user.id, row, tx), ['deleted']);
      const base = await tx.execute({ sql: 'SELECT payload, deleted FROM pocket_travel_history WHERE trip_uid = ? AND revision = ?', args: [body.uid, body.baseRevision] });
      if (!base.rows[0] || Number(base.rows[0].deleted)) throw conflict('This trip revision is no longer available. Reload the trip.', await metadataDTO(user.id, row, tx));
      const remote = JSON.parse(String(row.payload)), { value, conflicts } = mergeTrip(JSON.parse(String(base.rows[0].payload)), body.value, remote);
      if (conflicts.length) throw conflict('This trip changed in the same place. Review both versions.', await metadataDTO(user.id, row, tx), conflicts);
      let normalized;
      try { normalized = validateTravelTrip(value); }
      catch (error) {
        if (![400, 413].includes(error.status)) throw error;
        throw conflict('The combined edits exceed this trip\'s limits. Review the changes before retrying.', await metadataDTO(user.id, row, tx), ['limits']);
      }
      if (canonical(normalized) !== canonical(remote)) await writeVersion(tx, row, normalized, user.id);
      await remember(tx, user.id, body, requestHash, body.uid);
      return { record: await metadataDTO(user.id, row, tx) };
    }
    if (body.action === 'delete') {
      requireOwner(row);
      if (Number(row.deleted)) { await remember(tx, user.id, body, requestHash, body.uid); return { record: await metadataDTO(user.id, row, tx) }; }
      if (Number(row.revision) !== body.baseRevision) throw conflict('This trip changed. Reload it before deleting.', await metadataDTO(user.id, row, tx));
      await writeVersion(tx, row, null, user.id, true);
      await tx.execute({ sql: 'UPDATE pocket_travel_invites SET revoked = 1 WHERE trip_uid = ?', args: [body.uid] });
      await remember(tx, user.id, body, requestHash, body.uid);
      return { record: await metadataDTO(user.id, row, tx) };
    }
    if (body.action === 'leave') {
      if (row.role === 'owner') throw invalid('The owner cannot leave their own trip.');
      const record = await metadataDTO(user.id, row, tx);
      await tx.execute({ sql: 'DELETE FROM pocket_travel_members WHERE trip_uid = ? AND user_id = ?', args: [body.uid, user.id] });
      return { uid: body.uid, left: true, record: { uid: record.uid, revision: record.revision, left: true } };
    }
    requireOwner(row);
    if (body.action === 'invite') {
      const count = await tx.execute({ sql: 'SELECT COUNT(*) AS total FROM pocket_travel_invites WHERE trip_uid = ? AND revoked = 0 AND accepted_by IS NULL AND expires_at > ?', args: [body.uid, Date.now()] });
      if (Number(count.rows[0].total) >= 50) throw invalid('This trip already has 50 open invitations.');
      const inviteId = randomUUID(), rawToken = randomBytes(32).toString('base64url'), expiresAt = Date.now() + 7 * DAY_MS;
      await tx.execute({ sql: 'INSERT INTO pocket_travel_invites (id, trip_uid, token_hash, email, role, expires_at) VALUES (?, ?, ?, ?, ?, ?)', args: [inviteId, body.uid, hash(rawToken), body.email, body.role, expiresAt] });
      return { record: await metadataDTO(user.id, row, tx), invite: { id: inviteId, email: body.email, role: body.role, expiresAt }, token: rawToken };
    }
    if (body.action === 'revoke') {
      await tx.execute({ sql: 'UPDATE pocket_travel_invites SET revoked = 1 WHERE id = ? AND trip_uid = ?', args: [body.inviteId, body.uid] });
      return { record: await metadataDTO(user.id, row, tx) };
    }
    if (body.action === 'remove') {
      if (body.userId === String(row.owner_id)) throw invalid('The trip owner cannot be removed.');
      await tx.execute({ sql: 'DELETE FROM pocket_travel_members WHERE trip_uid = ? AND user_id = ? AND role <> \'owner\'', args: [body.uid, body.userId] });
      return { record: await metadataDTO(user.id, row, tx) };
    }
    throw invalid('Choose a travel action.');
  });
}

async function inviteRow(db, rawToken) {
  const result = await db.execute({ sql: 'SELECT i.*, t.owner_id, t.deleted, t.payload, u.name AS inviter_name FROM pocket_travel_invites i JOIN pocket_travel t ON t.uid = i.trip_uid JOIN pocket_user u ON u.id = t.owner_id WHERE i.token_hash = ?', args: [hash(rawToken)] });
  return result.rows[0];
}
function inviteUnavailable(row) { return !row || Number(row.deleted) || Number(row.revoked) || Number(row.expires_at) <= Date.now(); }
function eligibility(row, user) {
  if (!user) return { eligible: false, reason: 'Sign in to accept this invitation.' };
  if (String(row.owner_id) === user.id) return { eligible: false, reason: 'This is your own trip.' };
  if (row.accepted_by && String(row.accepted_by) !== user.id) return { eligible: false, reason: 'This invitation has already been used.' };
  if (row.email && String(row.email).toLowerCase() !== String(user.email).trim().toLowerCase()) return { eligible: false, reason: 'Sign in with the email this invitation was sent to.' };
  return { eligible: true };
}
export async function previewTravelInvite(user, rawToken) {
  token(rawToken); await ensureTravelSchema();
  const row = await inviteRow(database(), rawToken);
  if (inviteUnavailable(row)) throw Object.assign(new Error('This invitation has expired or is no longer available.'), { status: 404 });
  let eligible = eligibility(row, user);
  if (eligible.eligible && row.accepted_by) {
    const membership = await database().execute({ sql: 'SELECT 1 FROM pocket_travel_members WHERE trip_uid = ? AND user_id = ?', args: [String(row.trip_uid), user.id] });
    if (!membership.rows.length) eligible = { eligible: false, reason: 'This invitation has already been used. Ask the owner for a new invitation.' };
  }
  // Possession of the link exposes only invitation metadata, never booking data or members.
  return { invite: { title: JSON.parse(String(row.payload)).title, inviter: { name: String(row.inviter_name) }, role: String(row.role), expiresAt: Number(row.expires_at), signedIn: Boolean(user), ...eligible } };
}
async function acceptInvite(tx, user, rawToken) {
  const row = await inviteRow(tx, rawToken);
  if (inviteUnavailable(row)) throw Object.assign(new Error('This invitation has expired or is no longer available.'), { status: 404 });
  const eligible = eligibility(row, user);
  if (!eligible.eligible) throw Object.assign(new Error(eligible.reason), { status: 403 });
  if (row.accepted_by) {
    // A retry is valid only while the recipient still belongs to the trip; removed access cannot be restored by replay.
    const existing = await accessible(tx, user.id, String(row.trip_uid));
    return { record: await metadataDTO(user.id, existing, tx) };
  }
  const existing = await tx.execute({ sql: 'SELECT 1 FROM pocket_travel_members WHERE trip_uid = ? AND user_id = ?', args: [String(row.trip_uid), user.id] });
  if (!existing.rows.length) {
    const count = await tx.execute({ sql: 'SELECT COUNT(*) AS total FROM pocket_travel_members WHERE trip_uid = ?', args: [String(row.trip_uid)] });
    if (Number(count.rows[0].total) >= 50) throw invalid('This trip already has 50 participants.');
  }
  await tx.execute({ sql: 'INSERT INTO pocket_travel_members (trip_uid, user_id, role) VALUES (?, ?, ?) ON CONFLICT(trip_uid, user_id) DO UPDATE SET role = excluded.role WHERE pocket_travel_members.role <> \'owner\'', args: [String(row.trip_uid), user.id, String(row.role)] });
  const consumed = await tx.execute({ sql: 'UPDATE pocket_travel_invites SET accepted_by = ?, accepted_at = ? WHERE id = ? AND accepted_by IS NULL AND revoked = 0 RETURNING id', args: [user.id, Date.now(), String(row.id)] });
  if (!consumed.rows.length) throw conflict('This invitation has already been used.');
  return { record: await metadataDTO(user.id, { uid: String(row.trip_uid) }, tx) };
}
