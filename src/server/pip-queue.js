import { randomUUID } from 'node:crypto';
import { execute as sql } from './database.js';

// A job is one queued stretch of a Pip run. The run row stays the authority on what the reply is doing; the job
// row only says that a worker should pick it up. Keeping both means a worker can die at any point: the job lease
// is renewed by the claim, and an expired one is handed to another worker (or failed) without touching the
// conversation. No external queue service is involved — Turso is the queue.

/** Long enough for one stretch (RUN_DEADLINE) plus a margin, so a live worker is never double-claimed. */
export const JOB_LEASE = (() => {
  const value = Number(process.env.PIP_WORKER_JOB_LEASE_MS);
  return Number.isInteger(value) && value >= 60000 && value <= 900000 ? value : 210000;
})();
export const MAX_ATTEMPTS = (() => {
  const value = Number(process.env.PIP_WORKER_MAX_ATTEMPTS);
  return Number.isInteger(value) && value >= 1 && value <= 20 ? value : 3;
})();
const backoff = attempts => Math.min(30000, 1000 * Math.max(1, attempts));
let lastExpiry = 0;

/** Queues a run for a worker. A run already leased by a live worker keeps its claim. */
export async function enqueue(userId, runId, { now = Date.now(), delay = 0 } = {}) {
  await sql({ sql: `INSERT INTO pocket_pip_jobs (user_id, run_id, state, attempts, not_before, lease_id, lease_until, error, created, updated)
    VALUES (?, ?, 'queued', 0, ?, '', 0, '', ?, ?)
    ON CONFLICT(user_id, run_id) DO UPDATE SET state = 'queued', not_before = excluded.not_before, error = '', updated = excluded.updated
    WHERE pocket_pip_jobs.state <> 'leased'`,
    args: [userId, runId, now + Math.max(0, delay), now, now] });
}

/**
 * The next job to execute, marked leased for this worker. An expired lease is returned to the queue first; a job
 * that used up its attempts is failed so a poison run cannot be retried forever.
 */
export async function claimJob({ now = Date.now(), lease = JOB_LEASE } = {}) {
  // Recovering dead workers is a write; do it at most every few seconds per process so an idle poll stays cheap.
  if (now - lastExpiry >= 5000) { lastExpiry = now; await requeueExpired(now); }
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = (await sql({ sql: "SELECT user_id, run_id FROM pocket_pip_jobs WHERE state = 'queued' AND not_before <= ? ORDER BY not_before, created LIMIT 1", args: [now] })).rows[0];
    if (!row) return null;
    const leaseId = randomUUID();
    const claimed = (await sql({ sql: `UPDATE pocket_pip_jobs SET state = 'leased', lease_id = ?, lease_until = ?, attempts = attempts + 1, updated = ?
      WHERE user_id = ? AND run_id = ? AND state = 'queued' AND not_before <= ? RETURNING attempts`,
      args: [leaseId, now + lease, now, row.user_id, row.run_id, now] })).rows[0];
    if (claimed) return { userId: String(row.user_id), runId: String(row.run_id), leaseId, attempts: Number(claimed.attempts) };
  }
  return null;
}

/** The stretch finished: either the run settled or it is waiting for a decision, which needs no worker. */
export async function finishJob(userId, runId, state = 'done', error = '', now = Date.now()) {
  await sql({ sql: 'UPDATE pocket_pip_jobs SET state = ?, lease_id = ?, lease_until = 0, error = ?, updated = ? WHERE user_id = ? AND run_id = ?',
    args: [state, '', String(error || '').slice(0, 300), now, userId, runId] });
}

/** The stretch ended without settling the run. Retry with backoff until the attempt limit, then fail the job. */
export async function releaseJob(userId, runId, { now = Date.now(), error = '', delay } = {}) {
  const row = (await sql({ sql: 'SELECT attempts FROM pocket_pip_jobs WHERE user_id = ? AND run_id = ?', args: [userId, runId] })).rows[0];
  const attempts = Number(row?.attempts) || 0;
  if (attempts >= MAX_ATTEMPTS) return finishJob(userId, runId, 'failed', error || 'The worker stopped too often.', now);
  await sql({ sql: `UPDATE pocket_pip_jobs SET state = 'queued', lease_id = '', lease_until = 0, not_before = ?, error = ?, updated = ?
    WHERE user_id = ? AND run_id = ?`,
    args: [now + (delay ?? backoff(attempts)), String(error || '').slice(0, 300), now, userId, runId] });
}

/** Leases held by workers that stopped without finishing. Returns how many jobs were failed. */
export async function requeueExpired(now = Date.now()) {
  await sql({ sql: `UPDATE pocket_pip_jobs SET state = 'queued', lease_id = '', lease_until = 0, not_before = ?, updated = ?
    WHERE state = 'leased' AND lease_until <= ? AND attempts < ?`, args: [now, now, now, MAX_ATTEMPTS] });
  const failed = await sql({ sql: `UPDATE pocket_pip_jobs SET state = 'failed', error = 'The worker lease expired.', updated = ?
    WHERE state = 'leased' AND lease_until <= ? AND attempts >= ?`, args: [now, now, MAX_ATTEMPTS] });
  return Number(failed.rowsAffected) || 0;
}

/** Counts for the worker health endpoint and the sweep. */
export async function jobStats(now = Date.now()) {
  const rows = (await sql({ sql: 'SELECT state, COUNT(*) AS count FROM pocket_pip_jobs GROUP BY state', args: [] })).rows;
  const counts = Object.fromEntries(rows.map(row => [String(row.state), Number(row.count)]));
  const due = (await sql({ sql: "SELECT COUNT(*) AS count FROM pocket_pip_jobs WHERE state = 'queued' AND not_before <= ?", args: [now] })).rows[0];
  return { queued: Number(counts.queued) || 0, leased: Number(counts.leased) || 0, done: Number(counts.done) || 0,
    failed: Number(counts.failed) || 0, due: Number(due?.count) || 0 };
}

/** The jobs belonging to one run, for tests and operator checks. */
export async function jobOf(userId, runId) {
  return (await sql({ sql: 'SELECT * FROM pocket_pip_jobs WHERE user_id = ? AND run_id = ?', args: [userId, runId] })).rows[0] || null;
}
