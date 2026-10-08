// Run: node scripts/travel-server-check.mjs
// Every database URL, auth secret, session, and account below is an isolated
// temporary fixture. This script never reads .env or an existing database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, unlink, rmdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, basename, resolve, sep } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

if (process.argv[2] !== '--fixture-worker') {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-travel-check-'));
  const fixtureFile = join(directory, 'fixture.db');
  let result = 1;
  try {
    // A child process ensures SQLite handles are released before cleanup on
    // Windows, including handles retained by authentication's adapter.
    result = await new Promise((finish, fail) => {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--fixture-worker', fixtureFile], { stdio: 'inherit', windowsHide: true });
      child.once('error', fail); child.once('exit', code => finish(code ?? 1));
    });
  } finally {
    for (const suffix of ['', '-wal', '-shm']) {
      try { await unlink(fixtureFile + suffix); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    await rmdir(directory);
  }
  process.exit(result);
}
const fixtureFile = resolve(process.argv[3] || '');
const expectedTemp = resolve(tmpdir()) + sep;
assert.equal(fixtureFile.toLowerCase().startsWith(expectedTemp.toLowerCase()), true, 'Fixture must be inside the system temp directory.');
assert.equal(basename(dirname(fixtureFile)).startsWith('pocket-travel-check-'), true, 'Fixture must use a newly created travel check directory.');
assert.equal(basename(fixtureFile), 'fixture.db');
await assert.rejects(() => access(fixtureFile), error => error.code === 'ENOENT', 'An existing database must never be used.');
const fixtureURL = pathToFileURL(fixtureFile).href;
process.env.TURSO_DATABASE_URL = fixtureURL;
process.env.TURSO_AUTH_TOKEN = 'local-travel-fixture';
process.env.BETTER_AUTH_SECRET = 'local-travel-fixture-only-32-character-secret';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4321';
assert.equal(process.env.TURSO_DATABASE_URL.startsWith('file:'), true);
const { database } = await import('../src/server/database.js');
const { ensureTravelSchema, mutateTravel, readTravel, previewTravelInvite, validateTravelTrip } = await import('../src/server/travel.js');
const { normalizeTrip, canonical, mergeTrip } = await import('../src/shared/travel-data.js');
const { GET, POST } = await import('../src/pages/api/travel.ts');
const origin = process.env.BETTER_AUTH_URL;
const users = ['owner', 'editor', 'viewer', 'other'].map(id => ({ id, name: id, email: `${id}@example.com` }));
const [owner, editor, viewer, other] = users;
const sessionTokens = new Map(users.map(user => [user.id, randomUUID()]));
const op = (user, action, data) => mutateTravel(user, { accountId: user.id, action, ...data });
const rejects = (run, status) => assert.rejects(run, error => error.status === status);
const api = async (method, user, body, query = '', extraHeaders = {}) => {
  const headers = { ...(user ? { authorization: `Bearer ${sessionTokens.get(user.id)}` } : {}), ...extraHeaders };
  if (body) headers['content-type'] = 'application/json';
  const request = new Request(origin + '/api/travel' + query, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const response = await (method === 'GET' ? GET : POST)({ request });
  return { status: response.status, body: await response.json() };
};

try {
  await ensureTravelSchema();
  const now = Date.now();
  for (const user of users) {
    await database().execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [user.id, user.name, user.email, now, now] });
    await database().execute({ sql: 'INSERT INTO pocket_session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)', args: [randomUUID(), now + 3600_000, sessionTokens.get(user.id), now, now, user.id] });
  }
  assert.equal((await api('GET', null)).status, 401);
  assert.equal((await api('POST', owner, {}, '', { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await api('POST', null, {}, '', { cookie: 'fake=session' })).status, 403);
  const local = normalizeTrip({ uid: 'legacy', title: 'Shared route', created: 1, updated: 1,
    stops: [{ uid: 'lima', place: 'Lima', stays: [{ uid: 'hotel', name: 'Hotel', bookingRef: 'PRIVATE-BOOKING', note: 'Private stay detail' }] }, { uid: 'cusco', place: 'Cusco' }] });
  assert.equal((await api('POST', owner, { accountId: other.id, action: 'create', localUid: local.uid, value: local, mutationId: 'spoof' })).status, 409);
  assert.equal((await readTravel(owner.id)).length, 0);
  const created = await api('POST', owner, { accountId: owner.id, action: 'create', localUid: local.uid, value: local, mutationId: 'migration' });
  assert.equal(created.status, 200); assert.equal(created.body.created, true);
  const base = created.body.record, uid = base.uid;
  assert.equal(uid === local.uid, false); assert.equal(base.role, 'owner'); assert.equal(base.revision, 1);
  const deduplicated = await op(owner, 'create', { localUid: local.uid, value: { ...local, title: 'Stale migration' }, mutationId: 'migration' });
  assert.equal(deduplicated.created, false); assert.equal(canonical(deduplicated.record.value), canonical(base.value));
  const separateOwner = await op(other, 'create', { localUid: local.uid, value: local, mutationId: 'create-other' });
  assert.equal(separateOwner.record.uid === uid, false);
  assert.equal((await api('GET', editor)).body.records.length, 0);
  await rejects(() => op(editor, 'sync', { uid, baseRevision: 1, value: base.value, mutationId: 'intruder' }), 404);

  const invitation = await op(owner, 'invite', { uid, email: editor.email, role: 'editor' });
  assert.equal(/^[A-Za-z0-9_-]{43}$/.test(invitation.token), true);
  const stored = (await database().execute({ sql: 'SELECT token_hash FROM pocket_travel_invites WHERE id = ?', args: [invitation.invite.id] })).rows[0];
  assert.equal(stored.token_hash === invitation.token, false);
  const publicPreview = await api('GET', null, null, '?invite=' + encodeURIComponent(invitation.token));
  assert.equal(publicPreview.status, 200);
  assert.deepEqual(Object.keys(publicPreview.body), ['invite']);
  assert.deepEqual(Object.keys(publicPreview.body.invite).sort(), ['eligible', 'expiresAt', 'inviter', 'reason', 'role', 'signedIn', 'title']);
  assert.equal(publicPreview.body.invite.title, 'Shared route'); assert.equal(publicPreview.body.invite.signedIn, false);
  assert.equal(JSON.stringify(publicPreview.body).includes('PRIVATE-BOOKING'), false);
  assert.equal(JSON.stringify(publicPreview.body).includes(editor.email), false);
  assert.equal((await previewTravelInvite(other, invitation.token)).invite.eligible, false);
  await rejects(() => op(other, 'accept', { token: invitation.token }), 403);
  const accepted = await api('POST', editor, { accountId: editor.id, action: 'accept', token: invitation.token });
  assert.equal(accepted.status, 200); assert.equal(accepted.body.record.role, 'editor'); assert.equal(accepted.body.record.invites, undefined);
  assert.equal((await op(editor, 'accept', { token: invitation.token })).record.uid, uid);
  await rejects(() => op(other, 'accept', { token: invitation.token }), 403);
  await rejects(() => op(editor, 'invite', { uid, role: 'editor' }), 403);
  const viewerInvite = await op(owner, 'invite', { uid, role: 'viewer' });
  await op(viewer, 'accept', { token: viewerInvite.token });
  await rejects(() => op(viewer, 'sync', { uid, baseRevision: 1, value: base.value, mutationId: 'viewer-forged-role', role: 'owner' }), 403);
  await rejects(() => op(viewer, 'delete', { uid, baseRevision: 1, mutationId: 'viewer-delete' }), 403);
  await rejects(() => op(owner, 'remove', { uid, userId: owner.id }), 400);
  const revoked = await op(owner, 'invite', { uid, role: 'viewer' });
  await op(owner, 'revoke', { uid, inviteId: revoked.invite.id });
  await rejects(() => previewTravelInvite(other, revoked.token), 404);
  await rejects(() => op(other, 'accept', { token: revoked.token }), 404);
  const expired = await op(owner, 'invite', { uid, role: 'viewer' });
  await database().execute({ sql: 'UPDATE pocket_travel_invites SET expires_at = ? WHERE id = ?', args: [Date.now() - 1, expired.invite.id] });
  await rejects(() => previewTravelInvite(other, expired.token), 404);
  await rejects(() => op(other, 'accept', { token: expired.token }), 404);
  const raceInvite = await op(owner, 'invite', { uid, role: 'viewer' });
  const race = await Promise.allSettled([op(editor, 'accept', { token: raceInvite.token }), op(other, 'accept', { token: raceInvite.token })]);
  assert.equal(race.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(race.filter(result => result.status === 'rejected' && result.reason.status === 403).length, 1);
  // Restore the intended editor role if that participant consumed the viewer invitation.
  const editorAgain = await op(owner, 'invite', { uid, email: editor.email, role: 'editor' });
  assert.equal((await op(editor, 'accept', { token: editorAgain.token })).record.role, 'editor');

  const ours = structuredClone(base.value), theirs = structuredClone(base.value);
  ours.stops[0].stays[0].rating = 4; ours.updated = 2;
  theirs.stops[0].stays[0].note = 'Quiet room'; theirs.updated = 3;
  await Promise.all([op(owner, 'sync', { uid, baseRevision: 1, value: ours, mutationId: 'owner-edit' }), op(editor, 'sync', { uid, baseRevision: 1, value: theirs, mutationId: 'editor-edit' })]);
  const latest = (await readTravel(owner.id)).find(record => record.uid === uid);
  assert.equal(latest.revision, 3); assert.equal(latest.value.stops[0].stays[0].rating, 4); assert.equal(latest.value.stops[0].stays[0].note, 'Quiet room');
  const competing = structuredClone(base.value); competing.stops[0].stays[0].rating = 2;
  const collision = await api('POST', editor, { accountId: editor.id, action: 'sync', uid, baseRevision: 1, value: competing, mutationId: 'collision' });
  assert.equal(collision.status, 409); assert.equal(collision.body.record.revision, 3);
  assert.equal(collision.body.conflicts.includes('stops[lima].stays[hotel].rating'), true);
  const deletion = structuredClone(base.value); deletion.stops[0].stays = [];
  assert.equal(mergeTrip(base.value, deletion, ours).conflicts.includes('stops[lima].stays[hotel]'), true);
  await op(owner, 'remove', { uid, userId: editor.id });
  assert.equal((await previewTravelInvite(editor, invitation.token)).invite.eligible, false);
  await rejects(() => op(editor, 'accept', { token: invitation.token }), 404);
  await rejects(() => op(editor, 'sync', { uid, baseRevision: 1, value: theirs, mutationId: 'editor-edit' }), 404);
  assert.equal((await readTravel(editor.id)).some(record => record.uid === uid), false);
  await rejects(() => op(owner, 'delete', { uid, baseRevision: 1, mutationId: 'stale-delete' }), 409);
  const tombstone = await op(owner, 'delete', { uid, baseRevision: 3, mutationId: 'delete' });
  assert.equal(tombstone.record.deleted, true); assert.equal(tombstone.record.value, null);
  assert.equal((await readTravel(viewer.id)).find(record => record.uid === uid).deleted, true);
  assert.equal((await op(owner, 'create', { localUid: local.uid, value: local, mutationId: 'create-after-delete' })).record.deleted, true);
  assert.equal((await op(owner, 'delete', { uid, baseRevision: 3, mutationId: 'delete' })).record.deleted, true);

  const badArray = structuredClone(local); badArray.stops[0].stays = 'malformed';
  assert.throws(() => validateTravelTrip(badArray), error => error.status === 400);
  const badLink = structuredClone(local); badLink.stops[0].stays[0].url = 'javascript:alert(1)';
  assert.throws(() => validateTravelTrip(badLink), error => error.status === 400);
  const badID = { ...local, uid: '../outside' }; assert.throws(() => validateTravelTrip(badID), error => error.status === 400);
  const duplicateID = structuredClone(local); duplicateID.stops.push(duplicateID.stops[0]);
  assert.throws(() => validateTravelTrip(duplicateID), error => error.status === 400);
  const poisoned = JSON.parse(JSON.stringify(local)); Object.defineProperty(poisoned, '__proto__', { value: { admin: true }, enumerable: true });
  assert.throws(() => validateTravelTrip(poisoned), error => error.status === 400);
  console.log('Travel local fixture checks passed: API authorization/origin/account isolation, safe invite preview, token storage/expiry/revocation/races, membership permissions, merge/conflicts/replays/tombstones, and input validation.');
} finally {
  database().close();
}
