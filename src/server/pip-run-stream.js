// A running reply as a numbered stream of changes, for the account's live sockets.
//
// Each run that someone follows has one encoder here, in the web process: it takes the run's turn as it changes
// (from a reply executing in this process, or forwarded from the worker), cuts it into blocks once, and publishes
// what changed since its last event as { kind: 'delta', seq, ops } (src/shared/pip-blocks.js). Every socket of the
// account gets the same events. The last events are kept, so a follower that missed some asks for those after its
// own number, and one that joins late (or fell too far behind) gets the whole state in one event.

import { listening, publish } from './pocket-events.js';
import { diffReply, emptyReply, replyOf, resetOp } from '../shared/pip-blocks.js';

/** At most one event per run this often: smooth to read, and a burst of tokens costs one event. */
const FRAME = 33;
/** Events kept per run for followers that missed some. */
const KEPT = 400;
const runs = new Map();

/** A run's turn changed. `event` is the hub's progress event: { runId, chat, requestId, turn }. */
export function feed(userId, event) {
  let run = runs.get(event.runId);
  if (!run) {
    if (!listening(userId)) return; // nobody to tell; a follower that comes later starts the encoder with the next change
    runs.set(event.runId, run = { userId, runId: event.runId, chat: event.chat, requestId: event.requestId, state: emptyReply(), seq: 0, log: [], turn: null, timer: null, last: 0 });
  }
  run.turn = event.turn;
  if (run.timer) return;
  run.timer = setTimeout(() => { run.timer = null; flush(run); }, Math.max(0, FRAME - (Date.now() - run.last)));
}

function flush(run) {
  if (!run.turn) return;
  // The turn keeps changing under us: what is compared, sent and kept is its own copy.
  const next = structuredClone(replyOf(run.turn)), ops = diffReply(run.state, next);
  run.last = Date.now();
  if (!ops.length) return;
  run.state = next; run.seq += 1;
  run.log.push({ seq: run.seq, ops });
  if (run.log.length > KEPT) run.log.shift();
  publish(run.userId, { type: 'run', kind: 'delta', runId: run.runId, chat: run.chat, requestId: run.requestId, seq: run.seq, ops });
}

/** A step of the run is about to be announced (awaiting, done, …): what is pending goes out first. */
export function settle(runId, ended = false) {
  const run = runs.get(runId);
  if (!run) return;
  clearTimeout(run.timer); run.timer = null; flush(run);
  if (ended) runs.delete(runId);
}

/**
 * What a follower at `after` is missing: the events since, or the whole state as one event when they are no longer
 * kept (or it has nothing yet). Empty when the run is not streamed here; the follower then reads the record.
 */
export function resume(userId, runId, after = 0) {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) return { seq: 0, events: [] };
  const first = run.log[0]?.seq ?? run.seq + 1;
  if (after > 0 && after >= first - 1 && after <= run.seq) return { seq: run.seq, events: run.log.filter(event => event.seq > after) };
  return { seq: run.seq, events: [{ seq: run.seq, ops: [resetOp(run.state)] }] };
}

/** For tests: forget every run. */
export function forgetRuns() { for (const run of runs.values()) clearTimeout(run.timer); runs.clear(); }
