// Which of Pocket's tools the native OpenClaw agent gets (services/gateway/pocket-plugin), and how a native reply is
// woken. No imports: the gateway config generator reads these lists before anything else of Pocket is loaded.
//
// Not ported: remember/forget (OpenClaw's memory owns that), update_plan (OpenClaw keeps its own run state),
// COROS writes (the training planner still owns them). Web search stays Pocket's: OpenClaw's Firecrawl
// provider is a separate plugin package, and Pocket's tools already use the account's Firecrawl key.
export const NATIVE_TOOLS = ['search_notes', 'read_note', 'search_thoughts', 'search_tasks', 'read_task', 'search_calendar', 'search_pocket',
  'read_chat_history', 'search_web', 'read_web_page', 'show_card', 'update_card', 'create_record', 'change_record',
  'list_jobs', 'create_job', 'change_job', 'remove_job', 'start_assignment', 'update_scratch', 'gym_summary', 'coros_summary', 'coros_read', 'coros_format'];
/** The calls the person approves first (a subset of pip-tools.js WRITE_TOOLS). */
export const NATIVE_WRITES = ['create_record', 'change_record', 'remove_job'];
/** Calls that change the answer or the person's data run one at a time, in order (as pip-agent.js does). */
export const NATIVE_SEQUENTIAL = ['show_card', 'update_card', 'create_record', 'change_record', 'create_job', 'change_job', 'remove_job'];

// A native reply waits on things other requests change: a decision (decideRun) or a message sent into it
// (queueMessage). Those requests wake it at once; the wait still looks again on its own, for a change made by another
// process. On globalThis because the web server and Astro's build load this module as separate copies.
const wakers = globalThis.__pocketNativeWakers ??= new Map();
/** Wakes whatever a run's native reply waits for. Harmless for any other run. */
export function wake(runId) { for (const fn of [...(wakers.get(runId) || [])]) fn(); }
/** Calls `fn` on every wake of the run until the returned function is called. */
export function onWake(runId, fn) {
  const set = wakers.get(runId) || new Set(); set.add(fn); wakers.set(runId, set);
  return () => { set.delete(fn); if (!set.size && wakers.get(runId) === set) wakers.delete(runId); };
}
/** Resolves on the run's next wake, after `ms`, or when `signal` aborts, whichever comes first. */
export const nap = (runId, ms, signal) => new Promise(resolve => {
  const done = () => { clearTimeout(timer); off(); signal?.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms), off = onWake(runId, done);
  signal?.addEventListener('abort', done, { once: true });
});

/** Unattended research may read and draw, but cannot start work or change the person's records. */
export const NATIVE_RESEARCH_TOOLS = NATIVE_TOOLS.filter(name => !NATIVE_WRITES.includes(name) && !['create_job', 'change_job', 'start_assignment', 'update_scratch'].includes(name));
