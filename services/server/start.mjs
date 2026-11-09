// Pocket as one long-running server: the web app (Astro's standalone Node build) and Pip's worker, started from
// the same image so they always run the same code. If either stops, the whole server stops and the platform
// restarts it; a stop signal is passed to both so the worker can hand back its jobs.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const port = process.env.PORT || '8080';
// The worker tells the web process what happened (a job's reply, a record it wrote), and the web process tells the
// open tabs. The secret lives only as long as these two processes.
const events = { POCKET_EVENTS_SECRET: randomBytes(24).toString('hex') };
const children = [
  spawn(process.execPath, ['services/server/web.mjs'], { stdio: 'inherit', env: { ...process.env, ...events, HOST: process.env.HOST || '0.0.0.0', PORT: port } }),
  // Replies run in the web process (PIP_RUNS_MODE); the worker executes what it claims itself, inside its own loop.
  spawn(process.execPath, ['services/pip/worker.mjs'], { stdio: 'inherit', env: { ...process.env, ...events, PIP_RUNS_MODE: '', POCKET_EVENTS_URL: 'http://127.0.0.1:' + port + '/internal/events' } }),
];
let stopping = false;
const stop = (signal = 'SIGTERM') => {
  if (stopping) return; stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
  setTimeout(() => process.exit(1), 25000).unref();
};
for (const child of children) child.on('exit', code => { if (!stopping) { console.error(JSON.stringify({ level: 'error', message: 'A Pocket process stopped', pid: child.pid, code })); stop(); } else if (children.every(item => item.exitCode !== null || item.signalCode)) process.exit(0); });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal));
