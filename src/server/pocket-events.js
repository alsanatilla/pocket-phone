// What happens in an account, as it happens: a reply starts, grows, waits for a decision or ends; a record changes;
// a job finishes. Every open tab of the account hears it over its live socket (services/server/web.mjs), so tabs and
// devices stay in step without polling.
//
// One hub per process, on globalThis: the web server and Astro's build load this module as separate copies, and
// both must reach the same subscribers. The worker runs in its own process; its events are forwarded to the web
// process over a local endpoint (POCKET_EVENTS_URL with POCKET_EVENTS_SECRET, set by services/server/start.mjs).
// Events are hints and deltas, never the record: a client that missed one reads the record again.

const hub = globalThis.__pocketEvents ??= { subscribers: new Map() };

/** Listens to one account's events. Returns the function that stops listening. */
export function subscribe(userId, listener) {
  let set = hub.subscribers.get(userId);
  if (!set) hub.subscribers.set(userId, set = new Set());
  set.add(listener);
  return () => { set.delete(listener); if (!set.size) hub.subscribers.delete(userId); };
}

/** Whether anyone in this process listens to the account. */
export const listening = userId => Boolean(hub.subscribers.get(userId)?.size);

/** Tells the account's listeners. Never throws: an event is a courtesy, the record is already written. */
export function publish(userId, event) {
  if (!userId || !event?.type) return;
  for (const listener of [...(hub.subscribers.get(userId) || [])]) {
    try { listener(event); } catch { /* one broken listener does not stop the others */ }
  }
  forward(userId, event);
}

// From the worker process: hand the event to the web process, which holds the sockets. Fire and forget, bounded.
const FORWARD = process.env.POCKET_EVENTS_URL || '', SECRET = process.env.POCKET_EVENTS_SECRET || '';
const waiting = new Map();
function forward(userId, event) {
  if (!FORWARD || !SECRET || hub.receiving) return;
  // A reply's progress arrives with every token: across processes only its latest state, at most every 400 ms.
  if (event.type === 'run' && event.kind === 'progress') {
    const pending = waiting.get(event.runId);
    if (pending) { pending.event = event; return; }
    waiting.set(event.runId, { event });
    setTimeout(() => { const latest = waiting.get(event.runId); waiting.delete(event.runId); if (latest) send(userId, latest.event); }, 400).unref?.();
    return;
  }
  send(userId, event);
}
function send(userId, event) {
  fetch(FORWARD, { method: 'POST', headers: { 'content-type': 'application/json', 'x-pocket-events': SECRET }, body: JSON.stringify({ userId, event }), signal: AbortSignal.timeout(2000) })
    .catch(() => { /* the web process may be restarting; clients read the record again on reconnect */ });
}

/** In the web process: events forwarded from the worker are published here and not forwarded again. */
export function receive(userId, event) {
  hub.receiving = true;
  try { publish(userId, event); } finally { hub.receiving = false; }
}
