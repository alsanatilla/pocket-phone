// Pocket's web process: Astro's Node build for pages and the API, plus the account's live socket at /api/live.
//
// One WebSocket per open tab carries what happens in the account as it happens (src/server/pocket-events.js): a
// reply starting, growing and ending, a decision it waits for, records changed on another device, a job's result.
// Pip's run commands (send, decide, stop, continue) travel over the same socket as requests ({ type: 'req', id,
// method: 'pip.runs', params } → { type: 'res', id, ok, payload | error }). Each is handed to the same endpoint a POST
// reaches (/api/pip/runs), with the socket's session and origin, so authentication, checks and logic live in one
// place. A tab without the socket sends the same commands as POSTs and follows replies over SSE.
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { WebSocketServer } from 'ws';

process.env.ASTRO_NODE_AUTOSTART = 'disabled';
const { handler } = await import('../../dist/server/entry.mjs');
const { authFor } = await import('../../src/server/auth.js');
const { subscribe, receive } = await import('../../src/server/pocket-events.js');
const { compactFrame } = await import('../../src/server/pip-frames.js');

const PORT = Number(process.env.PORT) || 8080, HOST = process.env.HOST || '0.0.0.0';
const SECRET = process.env.POCKET_EVENTS_SECRET || '';
/** One frame per reply per socket at most this often: smooth to read, a burst of tokens costs one frame. */
const FRAME = 33, PING = 25000, BUFFERED = 1 << 20;
const log = (level, fields) => console.log(JSON.stringify({ at: new Date().toISOString(), level, ...fields }));

const sameSecret = value => {
  const given = Buffer.from(String(value || '')), expected = Buffer.from(SECRET);
  return SECRET && given.length === expected.length && timingSafeEqual(given, expected);
};

const server = createServer((req, res) => {
  // Events from the worker process beside this one; never reachable from outside (loopback and a secret).
  if (req.url === '/internal/events') {
    const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
    if (req.method !== 'POST' || !local || !sameSecret(req.headers['x-pocket-events'])) { res.writeHead(404).end(); return; }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; if (body.length > 2_000_000) req.destroy(); });
    req.on('end', () => {
      try { const { userId, event } = JSON.parse(body); if (typeof userId === 'string' && event?.type) receive(userId, event); res.writeHead(204).end(); }
      catch { res.writeHead(400).end(); }
    });
    return;
  }
  handler(req, res);
});

// A message may carry a whole question with its attached sources, as a POST may (256 kB).
const sockets = new WebSocketServer({ noServer: true, maxPayload: 300 * 1024 });

/** The signed-in account of an upgrade request from Pocket's own pages, or null. */
async function accountOf(req) {
  const origin = String(req.headers.origin || ''), expected = process.env.BETTER_AUTH_URL || '';
  // A socket opened from another site would carry the person's cookie: only Pocket's own origin may open one.
  if (!origin || (expected && origin !== expected && origin !== 'http://' + req.headers.host && origin !== 'https://' + req.headers.host)) return null;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
  const request = new Request((expected || 'http://' + req.headers.host) + '/api/live', { headers });
  const session = await (await authFor(request)).api.getSession({ headers }).catch(() => null);
  return session?.user?.id || null;
}

server.on('upgrade', async (req, socket, head) => {
  if (!req.url?.startsWith('/api/live')) { socket.destroy(); return; }
  const userId = await accountOf(req).catch(() => null);
  if (!userId) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  // What a command needs to pass as this tab: its session cookie and Pocket's origin.
  const as = { cookie: String(req.headers.cookie || ''), origin: String(req.headers.origin || '') };
  sockets.handleUpgrade(req, socket, head, ws => open(ws, userId, as));
});

/** A command from a tab, through the endpoint its POST would reach. Resolves to the response a POST would get. */
async function command(path, params, as) {
  const response = await fetch('http://127.0.0.1:' + PORT + path, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(120_000),
    headers: { 'content-type': 'application/json', cookie: as.cookie, origin: as.origin, 'x-forwarded-proto': as.origin.startsWith('https:') ? 'https' : 'http' }, body: JSON.stringify(params ?? {}) });
  const text = await response.text();
  let value = null; try { value = JSON.parse(text); } catch { /* not JSON: an error page */ }
  return { status: response.status, value };
}
/** The commands a tab may send over its socket, and where each goes. Nothing else is reachable this way. */
const COMMANDS = { 'pip.runs': '/api/pip/runs' };

function open(ws, userId, as) {
  let alive = true;
  const send = message => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message)); };
  // Per reply: what this socket already has (for deltas), and the latest progress waiting for its frame.
  const runs = new Map();
  const flush = runId => {
    const state = runs.get(runId);
    if (!state?.pending) return;
    const event = state.pending; state.pending = null; state.last = Date.now(); state.latest = event;
    // A socket that cannot keep up gets its next frame whole instead of a chain of deltas it may have missed.
    if (ws.bufferedAmount > BUFFERED) { state.sent = {}; return; }
    const frame = compactFrame({ run: { runId, chat: event.chat, status: 'running', turn: event.turn } }, state.sent);
    send({ type: 'event', event: 'run', data: { runId, kind: 'progress', chat: event.chat, requestId: event.requestId, turn: frame.run.turn, ...(frame.append ? { append: frame.append, at: frame.at } : {}) } });
  };
  const stop = subscribe(userId, event => {
    if (event.type === 'run' && event.kind === 'progress') {
      let state = runs.get(event.runId);
      if (!state) runs.set(event.runId, state = { sent: {}, pending: null, last: 0, timer: null });
      state.pending = event;
      if (state.timer) return;
      const wait = Math.max(0, FRAME - (Date.now() - state.last));
      state.timer = setTimeout(() => { state.timer = null; flush(event.runId); }, wait);
      return;
    }
    if (event.type === 'run') {
      // A step of the run (started, awaiting, done, …): progress waiting for its frame goes first.
      const state = runs.get(event.runId);
      if (state) { clearTimeout(state.timer); state.timer = null; flush(event.runId); }
      if (['done', 'failed', 'stopped'].includes(event.kind)) runs.delete(event.runId);
    }
    send({ type: 'event', event: event.type, data: event });
  });
  send({ type: 'hello', accountId: userId, at: Date.now() });
  ws.on('pong', () => { alive = true; });
  const beat = setInterval(() => {
    if (!alive) { ws.terminate(); return; }
    alive = false; ws.ping();
  }, PING);
  ws.on('message', raw => {
    let message; try { message = JSON.parse(String(raw)); } catch { return; }
    if (message?.type !== 'req') return;
    // A round trip, which tells the tab the connection is really there.
    if (message.method === 'ping') send({ type: 'res', id: message.id, ok: true });
    // A tab that started following a reply mid-way, or missed a frame, gets the whole state in the next frame.
    if (Object.hasOwn(COMMANDS, message.method)) {
      command(COMMANDS[message.method], message.params, as)
        .then(({ status, value }) => send(status < 400
          ? { type: 'res', id: message.id, ok: true, payload: value }
          : { type: 'res', id: message.id, ok: false, error: { status, message: String(value?.error || 'Pocket did not answer.'), ...(typeof value?.code === 'string' ? { code: value.code } : {}) } }))
        .catch(() => send({ type: 'res', id: message.id, ok: false, error: { status: 503, message: 'Pocket did not answer. Try again.' } }));
      return;
    }
    if (message.method === 'resync' && typeof message.params?.runId === 'string') {
      const state = runs.get(message.params.runId);
      if (state) { state.sent = {}; state.pending ||= state.latest; clearTimeout(state.timer); state.timer = null; flush(message.params.runId); }
      send({ type: 'res', id: message.id, ok: true });
    }
  });
  ws.on('close', () => { clearInterval(beat); stop(); for (const state of runs.values()) clearTimeout(state.timer); });
}

server.listen(PORT, HOST, () => log('info', { message: 'Pocket web listening', port: PORT, live: '/api/live' }));
