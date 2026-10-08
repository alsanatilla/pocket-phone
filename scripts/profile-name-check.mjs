// Run: node scripts/profile-name-check.mjs
// This test uses a newly created local database and never reads .env.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, unlink, rmdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.argv[2] !== '--fixture-worker') {
  const directory = await mkdtemp(join(tmpdir(), 'pocket-profile-check-'));
  const fixtureFile = join(directory, 'fixture.db');
  let result = 1;
  try {
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
assert.equal(fixtureFile.toLowerCase().startsWith((resolve(tmpdir()) + sep).toLowerCase()), true);
assert.equal(basename(dirname(fixtureFile)).startsWith('pocket-profile-check-'), true);
assert.equal(basename(fixtureFile), 'fixture.db');
await assert.rejects(() => access(fixtureFile), error => error.code === 'ENOENT', 'Never use an existing database.');
process.env.TURSO_DATABASE_URL = pathToFileURL(fixtureFile).href;
process.env.TURSO_AUTH_TOKEN = 'local-profile-fixture';
process.env.BETTER_AUTH_SECRET = 'local-profile-fixture-only-32-character-secret';
process.env.BETTER_AUTH_URL = 'http://127.0.0.1:4321';
assert.equal(process.env.TURSO_DATABASE_URL.startsWith('file:'), true);
const { database, ensureSchema } = await import('../src/server/database.js');
const { authFor } = await import('../src/server/auth.js');
const { POST } = await import('../src/pages/api/profile.ts');
const { mutateTravel, readTravel, previewTravelInvite } = await import('../src/server/travel.js');
const { normalizeTrip } = await import('../src/shared/travel-data.js');
const { chosenName } = await import('../src/shared/profile-name.js');
const origin = process.env.BETTER_AUTH_URL;
const req = (path, body, token, extraHeaders = {}) => new Request(origin + path, {
  method: 'POST', headers: { origin, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...extraHeaders }, body: JSON.stringify(body),
});
const api = async (body, token, extraHeaders) => { const response = await POST({ request: req('/api/profile', body, token, extraHeaders) }); return { status: response.status, body: await response.json() }; };
const authRequest = async (path, body, token) => {
  const request = req('/api/auth/' + path, body, token), auth = await authFor(request), response = await auth.handler(request);
  return { status: response.status, body: await response.json() };
};
const storedName = async id => String((await database().execute({ sql: 'SELECT name FROM pocket_user WHERE id = ?', args: [id] })).rows[0].name);

try {
  await ensureSchema();
  assert.equal(chosenName('  Ana\u0301  '), 'Aná');
  assert.equal([...chosenName('😀'.repeat(60))].length, 60);
  for (const name of ['', '   ', 'x'.repeat(61), 'Name\u0000', 'Name\u0085', 42, null]) assert.throws(() => chosenName(name));
  const created = await authRequest('sign-up/email', { email: 'profile-owner@example.com', password: 'FixturePassword123!', name: '  Owner Name  ' });
  assert.equal(created.status, 200); assert.equal(created.body.user.name, 'Owner Name'); assert.equal(typeof created.body.token, 'string');
  const owner = created.body.user, token = created.body.token;
  assert.equal(await storedName(owner.id), 'Owner Name');
  for (const [index, name] of ['   ', 'x'.repeat(61), 'Bad\u0085Name'].entries()) {
    const rejected = await authRequest('sign-up/email', { email: `profile-invalid-${index}@example.com`, password: 'FixturePassword123!', name });
    assert.equal(rejected.status, 400, 'Password signup validates chosen names on the server');
  }
  assert.equal((await api({ accountId: owner.id, name: 'New' }, null)).status, 401);
  assert.equal((await api({ accountId: owner.id, name: 'New' }, token, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await api({ accountId: owner.id, name: 'New' }, null, { origin: '', cookie: 'fake=session' })).status, 403);
  assert.equal((await api({ accountId: 'someone-else', name: 'Spoof' }, token)).status, 409);
  assert.equal(await storedName(owner.id), 'Owner Name');
  assert.equal((await api({ accountId: owner.id, name: 'New', role: 'admin' }, token)).status, 400);
  assert.equal((await api({ accountId: owner.id }, token)).status, 400);
  assert.equal((await api({ accountId: owner.id, name: 'x'.repeat(1100) }, token)).status, 413);
  for (const name of ['', '   ', 'x'.repeat(61), 'Bad\u0000Name', 'Bad\u0085Name', 42, null]) assert.equal((await api({ accountId: owner.id, name }, token)).status, 400);
  const renamed = await api({ accountId: owner.id, name: '  Ana\u0301  ' }, token);
  assert.equal(renamed.status, 200); assert.equal(renamed.body.accountId, owner.id); assert.equal(renamed.body.user.id, owner.id); assert.equal(renamed.body.user.name, 'Aná');
  assert.equal(await storedName(owner.id), 'Aná');
  for (const name of [' ', 'x'.repeat(61), 'Bad\u0085Name', 42]) assert.equal((await authRequest('update-user', { name }, token)).status, 400, 'Direct Better Auth update cannot bypass name validation');
  assert.equal(await storedName(owner.id), 'Aná');
  assert.equal((await authRequest('update-user', { name: '  New Owner  ' }, token)).status, 200); assert.equal(await storedName(owner.id), 'New Owner');
  const passkeyStart = await authRequest('pocket/start-account', { email: 'profile-passkey@example.com', name: '  Ana\u0301  ' });
  assert.equal(passkeyStart.status, 200);
  const claims = JSON.parse(Buffer.from(passkeyStart.body.context.split('.')[0], 'base64url').toString());
  assert.equal(claims.name, 'Aná'); assert.equal(claims.email, 'profile-passkey@example.com');
  assert.equal((await database().execute({ sql: 'SELECT COUNT(*) AS total FROM pocket_user WHERE email = ?', args: [claims.email] })).rows[0].total, 0, 'Starting passkey registration does not create the user');
  const optionsRequest = new Request(origin + '/api/auth/passkey/generate-register-options?context=' + encodeURIComponent(passkeyStart.body.context), { headers: { origin } });
  const optionsResponse = await (await authFor(optionsRequest)).handler(optionsRequest), options = await optionsResponse.json();
  assert.equal(optionsResponse.status, 200); assert.equal(options.user.name, claims.email); assert.equal(options.user.displayName, 'Aná');
  const tampered = Buffer.from(JSON.stringify({ ...claims, name: 'Someone else' })).toString('base64url') + '.' + passkeyStart.body.context.split('.')[1];
  const forgedRequest = new Request(origin + '/api/auth/passkey/generate-register-options?context=' + encodeURIComponent(tampered), { headers: { origin } });
  assert.equal((await (await authFor(forgedRequest)).handler(forgedRequest)).status, 400, 'Passkey profile name is protected by the signed context');
  assert.equal((await authRequest('pocket/start-account', { email: 'profile-invalid-passkey@example.com', name: '  ' })).status, 400);

  const local = normalizeTrip({ uid: 'profile-trip', title: 'Names travel together', created: 1, updated: 1, stops: [] });
  const shared = await mutateTravel(owner, { accountId: owner.id, action: 'create', localUid: local.uid, value: local, mutationId: randomUUID() });
  const invitation = await mutateTravel(owner, { accountId: owner.id, action: 'invite', uid: shared.record.uid, role: 'editor' });
  assert.equal((await readTravel(owner.id))[0].members.find(member => member.userId === owner.id).name, 'New Owner');
  assert.equal((await previewTravelInvite(null, invitation.token)).invite.inviter.name, 'New Owner');
  const revision = shared.record.revision;
  const again = await api({ accountId: owner.id, name: '  Reise Freundin  ' }, token); assert.equal(again.status, 200);
  const latest = (await readTravel(owner.id))[0]; assert.equal(latest.revision, revision, 'Profile edits do not write trip content');
  assert.equal(latest.members.find(member => member.userId === owner.id).name, 'Reise Freundin');
  assert.equal((await previewTravelInvite(null, invitation.token)).invite.inviter.name, 'Reise Freundin');
  console.log('Profile local fixture checks passed: guards/account isolation, Unicode validation, actual password signup/direct update hooks, signed passkey names and options, persistent names, fresh Travel members/invite previews.');
} finally { database().close(); }
