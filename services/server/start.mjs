// Pocket as one long-running server: the web app (Astro's standalone Node build) and Pip's worker, started from
// the same image so they always run the same code. If either stops, the whole server stops and the platform
// restarts it; a stop signal is passed to both so the worker can hand back its jobs.
import { spawn } from 'node:child_process';

const children = [
  spawn(process.execPath, ['dist/server/entry.mjs'], { stdio: 'inherit', env: { ...process.env, HOST: process.env.HOST || '0.0.0.0', PORT: process.env.PORT || '8080' } }),
  spawn(process.execPath, ['services/pip/worker.mjs'], { stdio: 'inherit', env: process.env }),
];
let stopping = false;
const stop = (signal = 'SIGTERM') => {
  if (stopping) return; stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
  setTimeout(() => process.exit(1), 25000).unref();
};
for (const child of children) child.on('exit', code => { if (!stopping) { console.error(JSON.stringify({ level: 'error', message: 'A Pocket process stopped', pid: child.pid, code })); stop(); } else if (children.every(item => item.exitCode !== null || item.signalCode)) process.exit(0); });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal));
