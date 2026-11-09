// The account's live socket (/api/live, services/server/web.mjs): what happens in the account, as it happens. One per
// tab while signed in. Listeners get every message; the socket reconnects on its own, sooner when the tab comes
// back or the network returns. Nothing depends on it: without it, replies stream over SSE and records sync on their
// usual schedule. With it, both are immediate.

const listeners = new Set();
let socket = null, account = '', open = false, attempts = 0, timer = 0, sequence = 0;
/** Requests waiting for their answer, by id. */
const waiting = new Map();

/** Listens to every message (`{ type: 'hello' | 'event' | 'res', … }`) and to `{ type: 'closed' }`. */
export function on(listener) { listeners.add(listener); return () => listeners.delete(listener); }
/** Whether the socket is connected and greeted for the signed-in account. */
export const connected = () => open;

const emit = message => { for (const listener of [...listeners]) { try { listener(message); } catch { /* a listener's own problem */ } } };

/** Opens the socket for an account (again, if it was another one). */
export function start(accountId) {
  if (!accountId || typeof WebSocket === 'undefined') return;
  if (account === accountId && socket) return;
  stop();
  account = accountId;
  connect();
}

/** Closes it for good (signed out). */
export function stop() {
  account = ''; clearTimeout(timer);
  const current = socket; socket = null;
  if (current) { current.onclose = null; current.close(); }
  if (open) { open = false; emit({ type: 'closed' }); }
  abandon();
}

/** Sends a request over the socket without waiting for its answer; false when it is not connected. */
export function request(method, params = {}) {
  if (!open || !socket) return false;
  socket.send(JSON.stringify({ type: 'req', id: ++sequence, method, params }));
  return true;
}

/**
 * Sends a request and resolves to its answer's payload. Rejects with the server's error (its message, `status` and
 * `code`), or with `{ name: 'LiveUnavailable' }` when the socket is not connected, closes first, or `ms` pass: the
 * caller then sends the same command another way.
 */
export function call(method, params = {}, ms = 30000) {
  if (!open || !socket) return Promise.reject(unavailable());
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(unavailable()); }, ms);
    waiting.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ type: 'req', id, method, params }));
  });
}
const unavailable = () => Object.assign(new Error('The live connection is not available.'), { name: 'LiveUnavailable' });
function settle(message) {
  const entry = waiting.get(message.id);
  if (!entry) return;
  waiting.delete(message.id); clearTimeout(entry.timer);
  if (message.ok) entry.resolve(message.payload);
  else entry.reject(Object.assign(new Error(message.error?.message || 'Pocket did not answer.'), { status: message.error?.status, ...(message.error?.code ? { code: message.error.code } : {}) }));
}
/** A closed socket answers nothing more: whoever waits sends their command another way. */
function abandon() { for (const [id, entry] of waiting) { clearTimeout(entry.timer); entry.reject(unavailable()); waiting.delete(id); } }

function connect() {
  clearTimeout(timer);
  if (!account) return;
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/live');
  socket = ws;
  ws.onmessage = message => {
    let data; try { data = JSON.parse(message.data); } catch { return; }
    if (data.type === 'hello') {
      // Another account's socket (a stale session after switching accounts) is not this tab's.
      if (data.accountId !== account) { ws.close(); return; }
      open = true; attempts = 0;
    }
    if (data.type === 'res') settle(data);
    emit(data);
  };
  ws.onclose = () => {
    if (socket !== ws) return;
    socket = null;
    if (open) { open = false; emit({ type: 'closed' }); }
    abandon();
    // 1 s, 2 s, 4 s … up to 30 s, with a little jitter so many tabs do not reconnect in step.
    const wait = Math.min(30000, 1000 * 2 ** attempts++) * (0.75 + Math.random() / 2);
    timer = setTimeout(connect, wait);
  };
}

// Back in the tab or back online: try at once instead of waiting out the backoff.
if (typeof window !== 'undefined') {
  const now = () => { if (account && !socket) { attempts = 0; connect(); } };
  window.addEventListener('online', now);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') now(); });
}
