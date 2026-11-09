import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = await mkdtemp(join(tmpdir(), 'pocket-surface-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(dir, 'test.db');
process.env.PIP_RUNS_MODE = 'inprocess';
const { ensureSchema, execute: sql, database } = await import('../src/server/database.js');
const { startSurface, surfaceView, settledSurfaces } = await import('../src/server/surfaces.js');
await ensureSchema();
for (const user of ['a', 'b']) await sql({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, 0, 0)', args: [user, user, user + '@test.example'] });
after(async () => { await settledSurfaces(); database().close(); await rm(dir, { recursive: true, force: true }); });
const spec = { root: 'main', elements: { main: { type: 'Stack', props: {}, children: [] } } };

test('run outlives the submitting request, deduplicates tabs, and restores a saved result', async () => {
  let finish, calls = 0;
  const generate = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const first = await startSurface('a', 'morning', false, generate);
  assert.equal(first.status, 'running');
  const second = await startSurface('a', 'morning', true, generate);
  assert.equal(second.runId, first.runId);
  assert.equal(calls, 1);
  assert.equal(await surfaceView('b', 'morning'), null);
  finish(spec);
  await settledSurfaces();
  assert.deepEqual((await surfaceView('a', 'morning')).spec, spec);
  assert.equal((await startSurface('a', 'morning', false, generate)).status, 'done');
  assert.equal(calls, 1);
});

test('failures are saved and only an explicit retry starts new work', async () => {
  await startSurface('a', 'evening', false, async () => { throw new Error('secret upstream payload'); });
  await settledSurfaces();
  const failed = await surfaceView('a', 'evening');
  assert.equal(failed.status, 'failed');
  assert.ok(!failed.error.includes('secret'));
  const retry = await startSurface('a', 'evening', true, async () => spec);
  await settledSurfaces();
  assert.notEqual(retry.runId, failed.runId);
  assert.equal((await surfaceView('a', 'evening')).status, 'done');
});

test('a timed-out old run cannot overwrite a replacement or another moment', async () => {
  let finishOld;
  await startSurface('a', 'old', false, () => new Promise(resolve => { finishOld = resolve; }));
  await sql({ sql: 'UPDATE pocket_surfaces SET started = 0 WHERE user_id = ? AND moment_key = ?', args: ['a', 'old'] });
  assert.equal((await surfaceView('a', 'old')).status, 'failed');
  await startSurface('a', 'old', true, async () => spec);
  finishOld({ root: 'wrong', elements: {} });
  await settledSurfaces();
  assert.deepEqual((await surfaceView('a', 'old')).spec, spec);
  assert.deepEqual((await surfaceView('a', 'morning')).spec, spec);
});
