import { account, connected, post, request } from './cloud.js';
import { access } from './pip-tools.js';

// A signed-in chat can run on Pocket's server instead of this tab. The run keeps its own provider messages and
// decisions, so the reply survives a closed tab, another device can settle an approval, and a reload reattaches
// to the run instead of asking again. This mirrors streamReply's contract: onUpdate(progress) while it works,
// approve(requests, signal) when it waits for the user, and a finished reply or a thrown error at the end.
const POLL = 700, WAIT = 120_000;
let cache = null;

/** Whether this account may run chats on the server (its own server key or a key in the account vault for this
 * chat's endpoint), with the state of a chat's last run. */
export async function serverRuns({ chat = '', config = null, force = false } = {}) {
  if (!connected()) return { available: false, run: null };
  const key = [chat, config?.provider || '', config?.baseUrl || '', config?.webSearch ? '1' : '0'].join('|');
  if (!force && cache && cache.key === key && Date.now() - cache.at < 60_000) return cache.state;
  const query = new URLSearchParams();
  if (chat) query.set('chat', chat);
  if (config?.provider) { query.set('provider', config.provider); query.set('baseUrl', config.baseUrl || ''); query.set('webSearch', config.webSearch ? '1' : '0'); }
  const state = await request('/api/pip/runs' + (query.size ? '?' + query : ''));
  cache = { at: Date.now(), key, state };
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

/** The `data:` frames of a server-sent stream, one parsed view at a time. Comments and a cut frame are skipped. */
async function* frames(body) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    // A dropped or cut connection ends the frames; the follower asks again from its cursor.
    const { value, done } = await reader.read().catch(() => ({ done: true }));
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let at;
    while ((at = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, at); buffer = buffer.slice(at + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try { yield JSON.parse(line.slice(5).trim()); } catch { /* a partial frame waits for the next chunk */ }
      }
    }
  }
}

/**
 * One run's answer: submit, watch, decide, stop. `turn.attempt` is the request id, so a retry reuses the run.
 *
 * A POST that runs part of the reply (the submit, the decision that settles a wait, a continue) answers only when that
 * stretch has finished or paused, so the tab does not wait for it. It follows the run by its own request id, which it
 * knows before the run exists, and the answer, each tool call and an approval show while the server works on them.
 */
export async function streamReplyRemote(chat, turn, { signal, onUpdate = () => {}, approve = null, storage = globalThis.localStorage } = {}) {
  const owner = account();
  if (!owner) throw new Error('Sign in to Pocket to run this reply on the server.');
  const device = deviceId(storage), requestId = turn.attempt || crypto.randomUUID();
  let runId = '', cursor = 0, changed = Date.now(), seen = '', failure = null, sending = 0, unwatch = () => {};
  /** Requests this tab has decided: a frame read before a decision landed still shows it pending. */
  const decided = new Set();
  const look = () => request('/api/pip/runs?request=' + encodeURIComponent(requestId) + '&after=' + cursor);
  /** Sends a POST without waiting for the stretch it runs. A failure cuts the watch short so the loop can look at it. */
  const send = task => {
    sending++;
    task().catch(error => { failure ||= error; unwatch(); }).finally(() => { sending--; });
  };
  /** After a failed POST: the run never started, or it still waits for what that POST was to settle. */
  const refused = view => !view.run || view.run.status === 'awaiting';

  // The chat's own access and timezone travel with the request: a run on a vaulted key has no server settings of its
  // own, so what this chat may read and where the user's day starts come from the tab they typed in.
  send(() => post('/api/pip/runs', { action: 'submit', accountId: owner.id, requestId, device, chatUid: chat.uid, text: turn.text,
    attempt: turn.attempt, turnUid: turn.uid, context: turn.context || [], grants: access(chat.config, storage),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    chat: { uid: chat.uid, title: chat.title, created: chat.created, config: chat.config } }));

  /** What one snapshot means for this reply: progress to show, a settled answer, or a question to answer. */
  const step = async view => {
    const run = view.run;
    // Until the submit has created the run there is nothing to show yet.
    if (!run) { if (runId) throw new Error('This reply is no longer available on the server.'); return null; }
    runId = run.runId;
    // Live progress: the run's own turn carries the answer so far, its tool activity and its phase. The runtime
    // marker is what the chat shows as “on the server”, so a reply can be told apart from a tab-run one.
    const mark = JSON.stringify([run.status, run.turn, view.requests]);
    if (mark !== seen) {
      seen = mark; changed = Date.now();
      if (run.turn) onUpdate({ answer: run.turn.answer || '', reasoning: run.turn.reasoning || '', activity: run.turn.activity || [],
        sources: run.turn.sources || [], usage: { ...(run.turn.usage || {}), runtime: 'pocket-server' }, model: run.turn.model || turn.model, phase: run.turn.phase || 'requesting' });
    }
    if (run.status === 'done') return { ...run.turn, phase: 'done' };
    if (run.status === 'failed') throw new Error(run.turn?.error || 'The server reply failed.');
    if (run.status === 'stopped') throw Object.assign(new Error(run.turn?.error || 'Stopped. Continue or retry when you’re ready.'), { name: 'RunStopped' });
    if (run.status === 'awaiting') {
      const open = (view.requests || []).filter(item => item.state === 'pending'), asking = open.filter(item => !decided.has(item.id));
      // Every request is settled but the request that would continue the run ended first: continue it from here.
      if (!open.length) { if (!sending) send(() => post('/api/pip/runs', { action: 'continue', accountId: owner.id, runId: run.runId })); }
      else if (asking.length) {
        if (!approve) throw new Error('This reply is waiting for your approval, but approval is unavailable here.');
        // The same review cards the tab uses: the row id ties each request to its activity line.
        const decisions = await approve(asking.map(item => ({ approvalId: item.id, toolCallId: item.id, rowId: item.row,
          toolName: item.tool, input: item.payload?.device?.input || {} })), signal);
        changed = Date.now();
        for (const item of asking) decided.add(item.id);
        // One at a time: the decision that settles the last request continues the run inside its own POST.
        send(async () => {
          for (const item of asking) {
            const decision = decisions.get(item.id) || {};
            await post('/api/pip/runs', { action: 'decide', accountId: owner.id, runId: run.runId, requestId: item.id, device,
              approved: decision.approved === true, ...(decision.approved && decision.input ? { input: decision.input } : {}) });
          }
        });
      }
    }
    return null;
  };

  /**
   * Follow the run until this connection ends. Returns the settled reply when the run finishes inside the stream, or
   * `live: false` when this host cannot stream, so the caller asks again instead. A stream that came back at once is
   * not retried in a tight loop.
   */
  const follow = async () => {
    const opened = Date.now(), watch = new AbortController(), cut = () => watch.abort();
    signal?.addEventListener('abort', cut, { once: true }); unwatch = cut;
    try {
      const response = await fetch('/api/pip/runs/stream?request=' + encodeURIComponent(requestId) + '&after=' + cursor,
        { credentials: 'same-origin', headers: { accept: 'text/event-stream' }, signal: watch.signal }).catch(() => null);
      const type = String(response?.headers.get('content-type') || '');
      if (!response?.ok || !response.body || !type.includes('text/event-stream')) return { live: watch.signal.aborted };
      for await (const view of frames(response.body)) {
        if (Number.isSafeInteger(view.cursor) && view.cursor) cursor = view.cursor;
        const done = await step(view);
        if (done) return { live: true, done };
        if (watch.signal.aborted) break;
      }
      if (!watch.signal.aborted && Date.now() - opened < POLL) await wait(signal, POLL - (Date.now() - opened));
      return { live: true };
    } finally { signal?.removeEventListener('abort', cut); unwatch = () => {}; watch.abort(); }
  };

  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (Date.now() - changed > WAIT) throw new Error('The server reply is taking too long. It keeps running; open the chat again to see it.');
      const followed = failure ? { live: true } : await follow();
      if (followed.done) return followed.done;
      if (signal?.aborted) continue;
      if (!followed.live) await wait(signal, POLL);
      const view = await look();
      if (failure) { const error = failure; failure = null; if (refused(view)) throw error; }
      const done = await step(view);
      if (done) return done;
    }
  } catch (error) {
    if (!signal?.aborted) throw error;
    // Stop the run itself, not only this tab's view of it: a run left going would sync its answer back over the stop.
    const id = runId || (await look().catch(() => null))?.run?.runId;
    if (id) await post('/api/pip/runs', { action: 'stop', accountId: owner.id, runId: id, device }).catch(() => {});
    throw new DOMException('Stopped', 'AbortError');
  }
}
