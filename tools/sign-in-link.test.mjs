import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Moving to a new address: a passkey only works where it was made, so the person signs in there once with a
// one-time link and adds a passkey. The link must work once, only at its address, and only before it expires.

const dir = mkdtempSync(join(tmpdir(), 'pocket-handoff-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(dir, 'db.sqlite');
process.env.TURSO_AUTH_TOKEN = 'test-token';
process.env.BETTER_AUTH_SECRET = 'test-secret-for-handoff-links-0123456789';
process.env.BETTER_AUTH_URL = 'https://new.example';
const { ensureSchema, execute } = await import('../src/server/database.js');
const { authFor, signInLink } = await import('../src/server/auth.js');
test.after(() => rmSync(dir, { recursive: true, force: true }));

await ensureSchema();
const now = Date.now();
await execute({ sql: 'INSERT INTO pocket_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)', args: ['user-1', 'Ada', 'ada@example.com', now, now] });
const open = async url => (await authFor(new Request(url))).handler(new Request(url));

test('a sign-in link opens a session once, then leads to the account page', async () => {
  const response = await open(signInLink('user-1', 'https://new.example'));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://new.example/classic#/account');
  assert.match(response.headers.get('set-cookie') || '', /session_token=/);
});

test('a used, foreign, expired or forged link opens nothing', async () => {
  const link = signInLink('user-1', 'https://new.example');
  assert.equal((await open(link)).status, 302);
  const reused = await open(link);
  assert.equal(reused.status, 400); assert.match(await reused.text(), /already used/);
  const foreign = await open(signInLink('user-1', 'https://other.example').replace('https://other.example', 'https://new.example'));
  assert.equal(foreign.status, 400);
  const expired = await open(signInLink('user-1', 'https://new.example', { now: Date.now() - 16 * 60_000 }));
  assert.equal(expired.status, 400);
  const forged = await open(signInLink('user-1', 'https://new.example', { secret: 'someone-else' }));
  assert.equal(forged.status, 400);
  for (const response of [foreign, expired, forged]) assert.equal(response.headers.get('set-cookie'), null);
});
