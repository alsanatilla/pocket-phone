// Pocket as one long-running server: the web app (Astro's standalone Node build), Pip's worker and the OpenClaw
// gateway, started from the same image so they always run the same code. If any of them stops, the whole server
// stops and the platform restarts it; a stop signal is passed on so the worker can hand back its jobs.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = process.env.PORT || '8080';
// The OpenClaw gateway owns Pip's workspace, memory and reply loop. It listens on loopback only.
process.env.PIP_GATEWAY_TOKEN ||= randomBytes(24).toString('hex');
// The gateway's Pocket plugin calls the web process's /internal/pip-tools with this token. It lives only as long as
// these processes, like the events secret below.
process.env.PIP_TOOLS_TOKEN ||= randomBytes(24).toString('hex');
// The worker tells the web process what happened (a job's reply, a record it wrote), and the web process tells the
// open tabs. The secret lives only as long as these two processes.
const events = { POCKET_EVENTS_SECRET: randomBytes(24).toString('hex') };
const children = [
  spawn(process.execPath, ['services/server/web.mjs'], { stdio: 'inherit', env: { ...process.env, ...events, HOST: process.env.HOST || '0.0.0.0', PORT: port, PIP_WORKER_TOOLS_URL: 'http://127.0.0.1:' + (process.env.PIP_WORKER_PORT || '8787') + '/internal/pip-tools' } }),
  // Replies run in the web process (PIP_RUNS_MODE); the worker executes what it claims itself, inside its own loop.
  spawn(process.execPath, ['services/pip/worker.mjs'], { stdio: 'inherit', env: { ...process.env, ...events, PIP_RUNS_MODE: '', POCKET_EVENTS_URL: 'http://127.0.0.1:' + port + '/internal/events' } }),
];
const { writeGatewayConfig, gatewayPort, warmGateway } = await import('../gateway/config.mjs');
// One line at boot names the runtime versions: an OpenClaw upgrade is the change most likely to alter behaviour.
const openclawVersion = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../node_modules/openclaw/package.json'), 'utf8')).version;
console.log(JSON.stringify({ level: 'info', message: 'Pocket starting', node: process.version, openclaw: openclawVersion }));
const { path } = await writeGatewayConfig();
// Sessions, the agent database and the memory index live on the machine's own disk: SQLite on a network volume
// cost seconds per reply. The workspace (USER.md, MEMORY.md) stays on the volume and is what must survive.
const stateDir = process.env.OPENCLAW_STATE_DIR || '/tmp/openclaw';
// The index is in that ephemeral state directory, so every start begins with an empty one: rebuild it from the
// workspace's notes before the gateway takes the state lease (it refuses to let the CLI in once it is running).
// One agent at a time, and only those with notes: a full run over every configured agent took 122 s and held the
// start-up past its health check. A first index of one agent is seconds; the rest of the time is the embedding calls.
{
  const { spawnSync } = await import('node:child_process');
  const { existsSync, readdirSync, readFileSync } = await import('node:fs');
  const agents = Object.entries(JSON.parse(readFileSync(path, 'utf8')).agents?.entries || {});
  const started = Date.now();
  for (const [id, entry] of agents) {
    const workspace = String(entry?.workspace || '');
    const notes = workspace && existsSync(workspace) &&
      (existsSync(join(workspace, 'MEMORY.md')) || (existsSync(join(workspace, 'memory')) && readdirSync(join(workspace, 'memory')).length > 0));
    if (!notes) continue;
    const indexed = spawnSync(process.execPath, ['node_modules/openclaw/openclaw.mjs', 'memory', 'index', '--agent', id], {
      env: { ...process.env, OPENCLAW_CONFIG_PATH: path, OPENCLAW_STATE_DIR: stateDir }, encoding: 'utf8', timeout: 90000 });
    const line = String(indexed.stdout || indexed.stderr || '').trim().split('\n').filter(Boolean).slice(-1)[0] || '';
    console.log(JSON.stringify({ level: indexed.status === 0 ? 'info' : 'warn', message: 'Memory indexed', agent: id, code: indexed.status, ms: Date.now() - started, detail: line.slice(0, 200) }));
  }
}
const gatewayChild = spawn(process.execPath, ['node_modules/openclaw/openclaw.mjs', 'gateway', 'run'], { stdio: 'inherit',
  env: { ...process.env, OPENCLAW_CONFIG_PATH: path, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_GATEWAY_PORT: String(gatewayPort()), OPENCLAW_GATEWAY_TOKEN: process.env.PIP_GATEWAY_TOKEN } });
children.push(gatewayChild);
warmGateway().then(result => console.log(JSON.stringify({ level: 'info', message: 'OpenClaw gateway warmed', ...result })),
  error => console.error(JSON.stringify({ level: 'error', message: 'OpenClaw gateway warm-up failed', error: String(error?.message || error).slice(0, 200) })));
let stopping = false;
const stop = (signal = 'SIGTERM') => {
  if (stopping) return; stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill(signal);
  setTimeout(() => process.exit(1), 25000).unref();
};
for (const child of children) child.on('exit', code => {
  if (!stopping) { console.error(JSON.stringify({ level: 'error', message: 'A Pocket process stopped', pid: child.pid, code })); stop(); }
  else if (children.every(item => item.exitCode !== null || item.signalCode)) process.exit(0);
});
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => stop(signal));
