#!/usr/bin/env node
import http from 'node:http';
import { configured, database, ensureSchema } from '../../src/server/database.js';
import { drainRuns, workerStep } from '../../src/server/pip-runs.js';
import { jobStats } from '../../src/server/pip-queue.js';
import { runPipJob } from '../../src/server/pip-background.js';

// Pip's detached worker. It owns no state: the run row in Turso says what a reply is doing, the job row says a
// worker should pick it up, and a lease says which worker may write. Start as many copies as you like on as many
// boxes as you like — a job is executed once, and a worker that dies is replaced by the next one.
//
// It needs the same three secrets as the web app (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN and the encryption secret)
// and nothing else: provider keys are read per run from the account's sealed vault.

const number = (value, fallback, min, max) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
};
const concurrency = number(process.env.PIP_WORKER_CONCURRENCY, 2, 1, 16);
const poll = number(process.env.PIP_WORKER_POLL_MS, 1000, 100, 30000);
const port = number(process.env.PIP_WORKER_PORT, 8787, 0, 65535);
const once = process.argv.includes('--once') || process.env.PIP_WORKER_ONCE === '1';
/** Scheduled routines (check-ins, briefs, watches) can run here too, instead of a cron calling /api/jobs/pip. */
const routinesEvery = number(process.env.PIP_ROUTINES_EVERY_MS, 0, 0, 900000);
const startedAt = Date.now();
const state = { running: true, active: 0, done: 0, retried: 0, failed: 0, routines: 0, routinesFailed: 0, routineBusy: false };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const message = error => String(error?.message || error || 'Unknown error').slice(0, 500);
function log(level, fields) {
  const line = JSON.stringify({ at: new Date().toISOString(), level, ...fields });
  if (level === 'error') console.error(line); else console.log(line);
}

if (!configured()) {
  log('error', { error: 'Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before starting the Pip worker.' });
  process.exit(1);
}
if (!process.env.POCKET_ENCRYPTION_SECRET && !process.env.BETTER_AUTH_SECRET) {
  // secrets.js falls back to the database token, exactly as the web app does; no need to refuse to start.
  log('warn', { message: 'No POCKET_ENCRYPTION_SECRET or BETTER_AUTH_SECRET set; sealed provider keys fall back to TURSO_AUTH_TOKEN like the web app. Set one explicitly to decouple them.' });
}

await ensureSchema();
log('info', { message: 'Pip worker started', concurrency, pollMs: poll, once, pid: process.pid });

/**
 * A slot takes one job at a time and keeps taking jobs until the queue is empty. In --once mode it stops at the
 * first empty read, so a cron job can drain the queue and exit.
 */
async function slot(index) {
  for (;;) {
    if (!state.running && !state.active) return;
    let result = null;
    state.active++;
    try {
      result = await workerStep();
    } catch (error) {
      log('error', { slot: index, error: message(error) });
    } finally {
      state.active--;
    }
    if (!result) {
      if (once) return;
      if (!state.running) return;
      await sleep(poll + Math.floor(Math.random() * Math.max(50, poll / 4)));
      continue;
    }
    if (result.state === 'error' || result.state === 'retry') {
      state.retried++;
      log('warn', { slot: index, ...result });
    } else {
      state.done++;
      log('info', { slot: index, run: result.runId, state: result.state });
    }
    if (!state.running && !once) return;
  }
}

const health = port ? http.createServer(async (request, response) => {
  const url = String(request.url || '/');
  if (url.startsWith('/healthz')) {
    try {
      const jobs = await jobStats();
      const body = JSON.stringify({ ok: true, ready: true, active: state.active, done: state.done, retried: state.retried,
        uptimeMs: Date.now() - startedAt, pid: process.pid, jobs,
        routines: { everyMs: routinesEvery, ran: state.routines, failed: state.routinesFailed, busy: state.routineBusy } });
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(body);
    } catch (error) {
      response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, error: message(error) }));
    }
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Pip worker');
}) : null;
if (health) health.listen(port, () => log('info', { message: 'Health endpoint listening', port }));

// Routines belong to the queue's owner: a claim on the routine row already stops two processes from running the
// same one, so this timer is safe next to a cron that calls /api/jobs/pip as well.
let routineTimer = null;
async function routineTick() {
  if (!state.running || state.routineBusy) return;
  state.routineBusy = true;
  try {
    const result = await runPipJob();
    state.routines++;
    if (result.ran || result.expired) log('info', { message: 'Routines checked', ...result });
  } catch (error) {
    state.routinesFailed++;
    log('error', { message: 'Routine check failed', error: message(error) });
  } finally { state.routineBusy = false; }
}
if (routinesEvery > 0) {
  log('info', { message: 'Routine scheduler running in the worker', everyMs: routinesEvery });
  setTimeout(routineTick, 2000);
  routineTimer = setInterval(routineTick, routinesEvery);
}

let stopping = false;
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  state.running = false;
  log('info', { message: 'Stopping after the current stretch', signal });
  // Replies this worker executes get 20 seconds to finish; one still running then is let go, so the next process
  // continues it instead of waiting for its lease.
  await Promise.race([drainRuns(20000), new Promise(resolve => setTimeout(resolve, 23000))]);
  // A stretch can run for the full Pip deadline; give it that long before closing the database.
  const deadline = Date.now() + number(process.env.PIP_WORKER_STOP_MS, 180000, 5000, 600000);
  while ((state.active > 0 || state.routineBusy) && Date.now() < deadline) await sleep(250);
  if (routineTimer) clearInterval(routineTimer);
  health?.close();
  try { database().close(); } catch { /* already closed */ }
  log('info', { message: 'Pip worker stopped', done: state.done, retried: state.retried });
  process.exit(0);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
process.on('unhandledRejection', error => log('error', { error: message(error), unhandled: true }));

const slots = Array.from({ length: concurrency }, (_, index) => slot(index));
await Promise.allSettled(slots);
if (once) {
  // A cron that runs this once gets the schedules as well, unless it already calls /api/jobs/pip.
  if (routinesEvery > 0) await routineTick();
  health?.close();
  try { database().close(); } catch { /* already closed */ }
  log('info', { message: 'Queue drained; worker exits', done: state.done, retried: state.retried });
  process.exit(0);
}
