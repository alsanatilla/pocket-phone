import { account, connected, post, request } from './cloud.js';

// A signed-in chat can run on Pocket's server instead of this tab. The run keeps its own provider messages and
// decisions, so the reply survives a closed tab, another device can settle an approval, and a reload reattaches
// to the run instead of asking again. This mirrors streamReply's contract: onUpdate(progress) while it works,
// approve(requests, signal) when it waits for the user, and a finished reply or a thrown error at the end.
const POLL = 700, WAIT = 120_000;
let cache = null;

/** Whether this account may run chats on the server (its “on its own” key), with the state of a chat's last run. */
export async function serverRuns({ chat = '', force = false } = {}) {
  if (!connected()) return { available: false, run: null };
  if (!force && cache && Date.now() - cache.at < 60_000) return cache.state;
  const state = await request('/api/pip/runs' + (chat ? '?chat=' + encodeURIComponent(chat) : ''));
  cache = { at: Date.now(), state };
  return state;
}
export const forgetServerRuns = () => { cache = null; };

/** A stable device id, the same one the local runner writes, so the server can tell who sent and decided what. */
function deviceId(storage = globalThis.localStorage) {
  let value = storage?.getItem('pocket:device-id');
  if (!value) { value = crypto.randomUUID(); storage?.setItem('pocket:device-id', value); }
  return value;
}

const wait = (signal, ms) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new DOMException('Stopped', 'AbortError'));
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')); };
  signal?.addEventListener('abort', stop, { once: true });
});

/** One run's answer: submit, watch, decide, stop. `turn.attempt` is the request id, so a retry reuses the run. */
export async function streamReplyRemote(chat, turn, { signal, onUpdate = () => {}, approve = null, storage = globalThis.localStorage } = {}) {
  const owner = account();
  if (!owner) throw new Error('Sign in to Pocket to run this reply on the server.');
  const device = deviceId(storage);
  const body = requestId => ({ action: 'submit', accountId: owner.id, requestId, device, chatUid: chat.uid, text: turn.text,
    attempt: turn.attempt, turnUid: turn.uid, context: turn.context || [], chat: { uid: chat.uid, title: chat.title, created: chat.created, config: chat.config } });
  let view = await post('/api/pip/runs', body(turn.attempt || crypto.randomUUID()));
  let cursor = 0, waited = 0;
  for (;;) {
    const run = view.run;
    if (!run) throw new Error('This reply is no longer available on the server.');
    // Live progress: the run's own turn carries the answer so far, its tool activity and its phase. The runtime
    // marker is what the chat shows as “on the server”, so a reply can be told apart from a tab-run one.
    if (run.turn) onUpdate({ answer: run.turn.answer || '', reasoning: run.turn.reasoning || '', activity: run.turn.activity || [],
      sources: run.turn.sources || [], usage: { ...(run.turn.usage || {}), runtime: 'pocket-server' }, model: run.turn.model || turn.model, phase: run.turn.phase || 'requesting' });
    if (run.status === 'done') return { ...run.turn, phase: 'done' };
    if (run.status === 'failed') throw new Error(run.turn?.error || 'The server reply failed.');
    if (run.status === 'stopped') throw Object.assign(new Error(run.turn?.error || 'Stopped. Continue or retry when you’re ready.'), { name: 'RunStopped' });
    if (run.status === 'awaiting') {
      const requests = (view.requests || []).filter(item => item.state === 'pending');
      if (!requests.length) { await post('/api/pip/runs', { action: 'continue', accountId: owner.id, runId: run.runId }); }
      else {
        if (!approve) throw new Error('This reply is waiting for your approval, but approval is unavailable here.');
        // The same review cards the tab uses: the row id ties each request to its activity line.
        const decisions = await approve(requests.map(item => ({ approvalId: item.id, toolCallId: item.id, rowId: item.row,
          toolName: item.tool, input: item.payload?.device?.input || {} })), signal);
        for (const item of requests) {
          const decision = decisions.get(item.id) || {};
          await post('/api/pip/runs', { action: 'decide', accountId: owner.id, runId: run.runId, requestId: item.id, device,
            approved: decision.approved === true, ...(decision.approved && decision.input ? { input: decision.input } : {}) });
        }
      }
    }
    if (waited > WAIT) throw new Error('The server reply is taking too long. It keeps running; open the chat again to see it.');
    if (signal?.aborted) { await post('/api/pip/runs', { action: 'stop', accountId: owner.id, runId: run.runId, device }).catch(() => {}); throw new DOMException('Stopped', 'AbortError'); }
    await wait(signal, POLL); waited += POLL;
    view = await request('/api/pip/runs?run=' + encodeURIComponent(run.runId) + '&after=' + cursor);
    cursor = view.cursor || cursor;
  }
}
