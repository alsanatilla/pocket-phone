// The runs this server process is executing right now, for the followers connected to the same process.
//
// A run's state lives in the database, so any device on any instance can follow it, decide for it or stop it. That
// is the record. This is the shortcut: while a run executes here, each change is handed to the followers here the
// moment it happens, instead of through a database write and a follower's next read. Followers on another instance
// (or of a run executed elsewhere) keep reading the database. The account's live sockets hear each change too.

import { publish as announce } from './pocket-events.js';

const runs = new Map();

/** Every change of a run executing here: the turn as it is now (the executing code keeps mutating its own copy). */
export function publish(runId, turn, meta = null) {
  let entry = runs.get(runId);
  if (!entry) { entry = { turn, version: 0, closed: false, waiters: new Set(), meta }; runs.set(runId, entry); }
  entry.turn = turn; entry.version += 1; entry.meta = meta || entry.meta;
  wake(entry);
  if (entry.meta?.userId) announce(entry.meta.userId, { type: 'run', runId, kind: 'progress', chat: entry.meta.chat, requestId: entry.meta.requestId, turn });
}

/** The run stopped executing here (finished, paused, failed, or handed off): followers read its record again. */
export function close(runId) {
  const entry = runs.get(runId);
  if (!entry) return;
  entry.closed = true; entry.version += 1;
  wake(entry);
  runs.delete(runId);
}

/** Whether a run is executing in this process. */
export const executing = runId => runs.has(runId);

/** The run's live turn and version, or null. */
export function current(runId) {
  const entry = runs.get(runId);
  return entry ? { turn: entry.turn, version: entry.version } : null;
}

/**
 * Resolves when the run changed after `version`, when it stops executing here, after `ms`, or when `signal` aborts.
 * Resolves to the new version (or -1 when it closed), never rejects.
 */
export function changed(runId, version, ms, signal) {
  const entry = runs.get(runId);
  if (!entry) return Promise.resolve(-1);
  if (entry.version !== version) return Promise.resolve(entry.version);
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); entry.waiters.delete(done); signal?.removeEventListener?.('abort', done); resolve(entry.closed ? -1 : entry.version); };
    const timer = setTimeout(done, ms);
    entry.waiters.add(done);
    signal?.addEventListener?.('abort', done, { once: true });
  });
}

function wake(entry) { for (const waiter of [...entry.waiters]) waiter(); }
