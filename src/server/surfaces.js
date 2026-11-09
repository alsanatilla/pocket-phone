import { randomUUID } from 'node:crypto';
import { execute as sql } from './database.js';

const DEADLINE = 150000;
const work = new Set();
export const settledSurfaces = () => Promise.allSettled([...work]);
const read = async (user, key) => (await sql({ sql: 'SELECT * FROM pocket_surfaces WHERE user_id = ? AND moment_key = ?', args: [user, key] })).rows[0];
const view = row => row ? { key: row.moment_key, runId: row.run_id, status: row.status, spec: row.spec ? JSON.parse(row.spec) : null, error: row.error } : null;

export async function surfaceView(user, key) {
  await sql({ sql: "UPDATE pocket_surfaces SET status = 'failed', error = 'Arrangement interrupted. Try again.' WHERE user_id = ? AND moment_key = ? AND status = 'running' AND started < ?", args: [user, key, Date.now() - DEADLINE - 10000] });
  return view(await read(user, key));
}

// The request only starts the work. Neither closing its response nor leaving Today cancels it.
// A conditional claim deduplicates tabs; run_id fences late writes after a timeout or retry.
export async function startSurface(user, key, force, generate) {
  const existing = await surfaceView(user, key);
  if (existing && (existing.status === 'running' || !force)) return existing;
  const id = randomUUID(), now = Date.now();
  const claimed = await sql({ sql: `INSERT INTO pocket_surfaces (user_id, moment_key, run_id, status, started, updated) VALUES (?, ?, ?, 'running', ?, ?)
    ON CONFLICT(user_id, moment_key) DO UPDATE SET run_id = excluded.run_id, status = 'running', error = '', started = excluded.started, updated = excluded.updated
    WHERE pocket_surfaces.status != 'running' AND ? = 1`, args: [user, key, id, now, now, force ? 1 : 0] });
  if (!claimed.rowsAffected) return surfaceView(user, key);
  const run = (async () => {
    try {
      const spec = await generate(AbortSignal.timeout(DEADLINE));
      await sql({ sql: "UPDATE pocket_surfaces SET spec = ?, status = 'done', updated = ? WHERE user_id = ? AND moment_key = ? AND run_id = ? AND status = 'running'", args: [JSON.stringify(spec), Date.now(), user, key, id] });
    } catch {
      await sql({ sql: "UPDATE pocket_surfaces SET status = 'failed', error = 'Could not arrange Today. Try again.', updated = ? WHERE user_id = ? AND moment_key = ? AND run_id = ? AND status = 'running'", args: [Date.now(), user, key, id] });
    }
  })().catch(error => console.error('Today persistence failed:', error?.code || 'storage'));
  work.add(run); void run.finally(() => work.delete(run));
  // Older moments are no longer useful. Never delete another running generation.
  await sql({ sql: "DELETE FROM pocket_surfaces WHERE user_id = ? AND updated < ? AND status != 'running'", args: [user, now - 7 * 86400000] });
  if (process.env.PIP_RUNS_MODE !== 'inprocess') await run;
  return surfaceView(user, key);
}
