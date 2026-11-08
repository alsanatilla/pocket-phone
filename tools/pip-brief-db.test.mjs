import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A brief must not mistake its own output for news, and must not miss the records it is about.
// Content (notes, tasks, thoughts, gym, journal) is one document per collection in pocket_documents; chats are
// objects in pocket_objects. A guard that read only one of the two would either run every night for nothing or
// never run at all. These tests use a throwaway libSQL file so the real SQL is exercised.

const dir = mkdtempSync(join(tmpdir(), 'pip-brief-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(dir, 'brief.db');
process.env.TURSO_AUTH_TOKEN = 'test-token';

const { database, ensureSchema } = await import('../src/server/database.js');
const { newestRecordAt } = await import('../src/server/pip-background.js');
const USER = 'brief-test-user';

await ensureSchema();
const db = database();
await db.execute({ sql: 'INSERT INTO pocket_user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 0, 1, 1)',
  args: [USER, 'Test', 'brief-test@example.com'] });

const object = (collection, uid, updated) => db.execute({ sql: 'INSERT INTO pocket_objects (user_id, collection, uid, payload, revision) VALUES (?, ?, ?, ?, 1)',
  args: [USER, collection, uid, JSON.stringify({ uid, updated })] });
const document = (name, updated) => db.execute({ sql: 'INSERT INTO pocket_documents (user_id, name, payload, revision, updated_at) VALUES (?, ?, ?, 1, ?)',
  args: [USER, name, JSON.stringify({ v: 1 }), updated] });

test('an empty workspace has nothing new', async () => {
  assert.equal(await newestRecordAt(USER), 0);
});

test('a chat the brief wrote itself is not news', async () => {
  await object('chats', 'pip-routine-brief-2026-11', 5_000);
  assert.equal(await newestRecordAt(USER), 0);
});

test('a content document is news', async () => {
  await document('notes.json', 6_000);
  assert.equal(await newestRecordAt(USER), 6_000);
});

test('an object outside chats is news', async () => {
  await object('zines', 'zine-1', 7_000);
  assert.equal(await newestRecordAt(USER), 7_000);
});

test('drafts, the clock and receipts are not news', async () => {
  await document('drafts.json', 8_500);
  await document('clock.json', 8_600);
  await document('receipt.json', 8_700);
  assert.equal(await newestRecordAt(USER), 7_000);
});

test('the newest of documents, objects and chats wins', async () => {
  await object('chats', 'pip-routine-brief-2026-12', 9_000);
  await document('tasks.json', 9_000);
  assert.equal(await newestRecordAt(USER), 9_000);
});

test('a record newer than the last brief wakes it', async () => {
  const lastRun = 8_500;
  assert.ok(await newestRecordAt(USER) > lastRun);
});
