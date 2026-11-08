import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A brief must not mistake its own output for news. It writes into a chat object every time it runs, so a guard that
// counted chats would run — and pay — every single night, whatever the user did. These tests use a throwaway libSQL
// file so the SQL that decides "is there anything new?" is exercised for real.

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

const write = (collection, uid, updated) => db.execute({ sql: 'INSERT INTO pocket_objects (user_id, collection, uid, payload, revision) VALUES (?, ?, ?, ?, 1)',
  args: [USER, collection, uid, JSON.stringify({ uid, updated })] });

test('an empty workspace has nothing new', async () => {
  assert.equal(await newestRecordAt(USER), 0);
});

test('a chat the brief wrote itself is not news', async () => {
  await write('chats', 'pip-routine-brief-2026-11', 5_000);
  assert.equal(await newestRecordAt(USER), 0);
});

test('a task is news', async () => {
  await write('tasks', 'task-1', 6_000);
  assert.equal(await newestRecordAt(USER), 6_000);
});

test('the newest content record wins, not the newest chat', async () => {
  await write('chats', 'pip-routine-brief-2026-12', 9_000);
  await write('notes', 'note-1', 7_500);
  assert.equal(await newestRecordAt(USER), 7_500);
});

test('a record older than the last brief does not wake it', async () => {
  const lastRun = 8_000;
  assert.ok(await newestRecordAt(USER) <= lastRun);
});
