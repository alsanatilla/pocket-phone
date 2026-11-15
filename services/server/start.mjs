// Pocket as one long-running server: the web app (Astro's standalone Node build) and Pip's worker, started from
// the same image so they always run the same code. If either stops, the whole server stops and the platform
// restarts it; a stop signal is passed to both so the worker can hand back its jobs.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const port = process.env.PORT || '8080';
// The OpenClaw gateway owns Pip's workspace, memory and reply loop when it is on. It listens on loopback only.
const gateway = process.env.PIP_GATEWAY === '1';
if (gateway) process.env.PIP_GATEWAY_TOKEN ||= randomBytes(24).toString('hex');
// Native Pip (PIP_OPENCLAW_NATIVE=1): the gateway's Pocket plugin calls the web process's /internal/pip-tools with this
// token. It lives only as long as these processes, like the events secret below.
if (gateway && process.env.PIP_OPENCLAW_NATIVE === '1') process.env.PIP_TOOLS_TOKEN ||= randomBytes(24).toString('hex');
// The worker tells the web process what happened (a job's reply, a record it wrote), and the web process tells the
// open tabs. The secret lives only as long as these two processes.
const events = { POCKET_EVENTS_SECRET: randomBytes(24).toString('hex') };
const children = [
  spawn(process.execPath, ['services/server/web.mjs'], { stdio: 'inherit', env: { ...process.env, ...events, HOST: process.env.HOST || '0.0.0.0', PORT: port, PIP_WORKER_TOOLS_URL: 'http://127.0.0.1:' + (process.env.PIP_WORKER_PORT || '8787') + '/internal/pip-tools' } }),
  // Replies run in the web process (PIP_RUNS_MODE); the worker executes what it claims itself, inside its own loop.
  spawn(process.execPath, ['services/pip/worker.mjs'], { stdio: 'inherit', env: { ...process.env, ...events, PIP_RUNS_MODE: '', POCKET_EVENTS_URL: 'http://127.0.0.1:' + port + '/internal/events' } }),
];
/** Native replies require the gateway: a failed child restarts the service with its siblings. */
const optional = new Set();
if (gateway) {
  const { writeGatewayConfig, gatewayHome, gatewayPort } = await import('../gateway/config.mjs');
  const { path } = await writeGatewayConfig();
  // Sessions, the agent database and the memory index live on the machine's own disk: SQLite on a network volume
  // cost seconds per reply. The workspace (USER.md, MEMORY.md) stays on the volume and is what must survive.
  const stateDir = process.env.OPENCLAW_STATE_DIR || '/tmp/openclaw';
  const gatewayChild = spawn(process.execPath, ['node_modules/openclaw/dist/index.js', 'gateway', 'run'], { stdio: 'inherit',
    env: { ...process.env, OPENCLAW_CONFIG_PATH: path, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_GATEWAY_PORT: String(gatewayPort()), OPENCLAW_GATEWAY_TOKEN: process.env.PIP_GATEWAY_TOKEN } });
  if (process.env.PIP_OPENCLAW_NATIVE !== '1') optional.add(gatewayChild);
  children.push(gatewayChild);
}
let stopping = false;
const stop = (signal = 'SIGTERM') => {
  if (stopping) return; stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
  setTimeout(() => process.exit(1), 25000).unref();
};
for (const child of children) child.on('exit', code => {
  if (optional.has(child)) {
    console.error(JSON.stringify({ level: 'error', message: 'The OpenClaw gateway stopped; Pocket keeps its in-process loop', pid: child.pid, code }));
    return;
  }
  if (!stopping) { console.error(JSON.stringify({ level: 'error', message: 'A Pocket process stopped', pid: child.pid, code })); stop(); }
  else if (children.every(item => item.exitCode !== null || item.signalCode)) process.exit(0);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal));
