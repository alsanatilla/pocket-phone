import { account, connected, post, request } from './cloud.js';
import { access } from './pip-tools.js';
import * as live from './live.js';
import { answerOf, applyOps, emptyReply, segmentsOf } from '../shared/pip-blocks.js';

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

/**
 * A run command (submit, decide, continue, stop): over the account's live socket when it is connected, else as a
 * POST. Each command is safe to repeat (a submit is keyed by its request id, a decision settles only a pending
 * request, a stop or continue of a settled run does nothing), so one the socket could not deliver is sent again.
 */
async function command(body) {
  const value = { ...body };
  if (live.connected()) {
    try { return await live.call('pip.runs', value, 30_000); }
    // Not delivered, or the session ended (the POST then signs this tab out the usual way): send it as a POST.
    catch (error) { if (error?.name !== 'LiveUnavailable' && error?.status !== 401) throw error; }
  }
  return post('/api/pip/runs', value);
}

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
export async function streamReplyRemote(chat, turn, { signal, onUpdate = () => {}, approve = null, storage = globalThis.localStorage, attach = false, onRun = () => {} } = {}) {
  const owner = account();
  if (!owner) throw new Error('Sign in to Pocket to run this reply on the server.');
  const device = deviceId(storage), requestId = attach ? '' : turn?.attempt || crypto.randomUUID();
  let runId = '', cursor = 0, changed = Date.now(), seen = '', failure = null, sending = 0, unwatch = () => {};
  /**
   * The reply as this tab has it. A streamed frame carries only what changed (pip-runs.js compactFrame): text added
   * to the answer and reasoning in `append`, and no activity or sources when they did not change.
   */
  const shown = { answer: '', reasoning: '', activity: [], sources: [] };
  const merge = view => {
    const turn = view.run?.turn;
    if (!turn) return null;
    // A delta that does not start where this tab's text ends follows a frame this tab missed: ask for the whole state.
    if (['answer', 'reasoning'].some(field => typeof view.at?.[field] === 'number' && typeof turn[field] !== 'string' && view.at[field] !== shown[field].length)) return { gap: true };
    for (const field of ['answer', 'reasoning']) {
      if (typeof turn[field] === 'string') shown[field] = turn[field];
      if (typeof view.append?.[field] === 'string') shown[field] += view.append[field];
    }
    for (const field of ['activity', 'sources']) if (Array.isArray(turn[field])) shown[field] = turn[field];
    return { ...turn, ...shown };
  };
  /**
   * The reply as the live socket streams it: blocks and the number of the last change applied (pip-blocks.js). The
   * chat draws these blocks as they are; nothing here parses the answer while it streams.
   */
  const stream = { seq: 0, state: emptyReply(), asking: false };
  const liveTurn = () => ({ answer: answerOf(stream.state.blocks), blocks: segmentsOf(stream.state.blocks), reasoning: stream.state.reasoning,
    activity: stream.state.activity, sources: stream.state.sources, usage: { ...stream.state.usage, runtime: 'pocket-server' }, model: stream.state.model || turn?.model, phase: stream.state.phase || 'requesting' });
  /** Asks for the changes after this tab's number (or the whole state) and applies them. One request at a time. */
  const catchUp = async id => {
    if (stream.asking) return;
    stream.asking = true;
    try { const missed = await live.call('run.resume', { runId: id, after: stream.seq }, 8000); for (const event of missed?.events || []) take(event); }
    catch { /* the socket went away; the caller falls back to the run's own stream */ }
    finally { stream.asking = false; }
  };
  /** One numbered change. Old ones are skipped; one that does not follow the last is a gap. Returns whether it applied. */
  const take = event => {
    const reset = event.ops.length === 1 && event.ops[0].o === 'reset';
    if (!reset && event.seq <= stream.seq) return true;
    if (!reset && event.seq !== stream.seq + 1) return false;
    if (!applyOps(stream.state, event.ops)) { stream.seq = 0; return false; }
    stream.seq = event.seq; changed = Date.now();
    onUpdate(liveTurn());
    return true;
  };
  /** Requests this tab has decided: a frame read before a decision landed still shows it pending. */
  const decided = new Set();
  // A submitting tab follows its own request; an attaching tab follows whatever runs in the chat, then that run.
  const where = () => runId ? 'run=' + encodeURIComponent(runId) : attach ? 'chat=' + encodeURIComponent(chat.uid) : 'request=' + encodeURIComponent(requestId);
  const look = () => request(attach && !runId ? '/api/pip/runs?chat=' + encodeURIComponent(chat.uid) + '&active=1' : '/api/pip/runs?' + where() + '&after=' + cursor);
  /** Sends a POST without waiting for the stretch it runs. A failure cuts the watch short so the loop can look at it. */
  const send = task => {
    sending++;
    task().catch(error => { failure ||= error; unwatch(); }).finally(() => { sending--; });
  };
  /** After a failed POST: the run never started, or it still waits for what that POST was to settle. */
  const refused = view => !view.run || view.run.status === 'awaiting';

  // The chat's own access and timezone travel with the request: a run on a vaulted key has no server settings of its
  // own, so what this chat may read and where the user's day starts come from the tab they typed in.
  if (!attach) send(() => command({ action: 'submit', accountId: owner.id, requestId, device, chatUid: chat.uid, text: turn.text,
    attempt: turn.attempt, turnUid: turn.uid, context: turn.context || [], grants: access(chat.config, storage),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    chat: { uid: chat.uid, title: chat.title, titled: Boolean(chat.titled), home: Boolean(chat.home), created: chat.created, config: chat.config } }));

  /** What one snapshot means for this reply: progress to show, a settled answer, or a question to answer. */
  const step = async (view, streamed = false) => {
    const run = view.run;
    // Until the submit has created the run there is nothing to show yet. An attaching tab found nothing running.
    if (!run) { if (runId) throw new Error('This reply is no longer available on the server.'); return attach ? { none: true } : null; }
    if (!runId) onRun(run);
    runId = run.runId;
    // While the socket streams a running reply, the record read here is behind it (it is a checkpoint): what is on
    // screen stays what the stream says, and the record decides only what the run is doing.
    const turnNow = stream.seq && !streamed && ['running', 'queued'].includes(run.status) ? { ...run.turn, ...liveTurn() } : merge(view);
    if (turnNow?.gap) return null;
    // Live progress: the run's own turn carries the answer so far, its tool activity and its phase. The runtime
    // marker is what the chat shows as “on the server”, so a reply can be told apart from a tab-run one.
    // A streamed frame is a change by construction; a polled view may repeat the last one.
    const mark = streamed ? '' : JSON.stringify([run.status, turnNow, view.requests]);
    if (streamed || mark !== seen) {
      seen = mark; changed = Date.now();
      if (turnNow) onUpdate({ answer: turnNow.answer || '', reasoning: turnNow.reasoning || '', activity: turnNow.activity || [],
        sources: turnNow.sources || [], usage: { ...(turnNow.usage || {}), runtime: 'pocket-server' }, model: turnNow.model || turn?.model, phase: turnNow.phase || 'requesting', ...(turnNow.blocks ? { blocks: turnNow.blocks } : {}) });
    }
    if (run.status === 'done') return { ...turnNow, phase: 'done' };
    if (run.status === 'failed') throw new Error(turnNow?.error || 'The server reply failed.');
    if (run.status === 'stopped') throw Object.assign(new Error(turnNow?.error || 'Stopped. Continue or retry when you’re ready.'), { name: 'RunStopped' });
    if (run.status === 'awaiting') {
      const open = (view.requests || []).filter(item => item.state === 'pending'), asking = open.filter(item => !decided.has(item.id));
      // Every request is settled but the request that would continue the run ended first: continue it from here.
      if (!open.length) { if (!sending) send(() => command({ action: 'continue', accountId: owner.id, runId: run.runId })); }
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
            await command({ action: 'decide', accountId: owner.id, runId: run.runId, requestId: item.id, device,
              approved: decision.approved === true, ...(decision.approved && decision.input ? { input: decision.input } : {}) });
          }
        });
      }
    }
    return null;
  };

  /**
   * Follow the run over the account's live socket: its progress arrives as deltas, each step of the run (waiting,
   * done, …) prompts one read of the record. Resolves when the run settles, or with `live: false` when the socket
   * closes, so the caller falls back to the run's own stream.
   */
  const followLive = () => new Promise(resolve => {
    let settled = false, chain = Promise.resolve(), quiet = Date.now();
    const finish = result => {
      if (settled) return; settled = true;
      off(); clearInterval(watchdog); signal?.removeEventListener('abort', aborted);
      resolve(result);
    };
    // One frame at a time, in order: a step must not overtake the progress before it.
    const handle = work => {
      chain = chain.then(work).then(done => { if (done) finish({ live: true, done }); })
        .catch(error => { failure ||= error; finish({ live: true }); });
    };
    const mine = data => runId ? data.runId === runId : attach ? data.chat === chat.uid : data.requestId === requestId;
    const off = live.on(message => {
      if (message.type === 'closed') { finish({ live: false }); return; }
      if (message.type !== 'event' || message.event !== 'run' || !mine(message.data)) return;
      const data = message.data; quiet = Date.now();
      const known = Boolean(runId);
      // A change to the reply is applied as it is; any other step of the run (waiting, done, …) reads its record once.
      // A reply restarted after its process died is written again from the start, and numbered again.
      if (data.kind === 'restarted') { stream.seq = 0; stream.state = emptyReply(); }
      if (data.kind === 'delta') { if (!take(data)) void catchUp(data.runId); }
      else handle(async () => step(await look()));
      // The first thing this tab hears of a run it did not start: its record says which turn it is.
      if (!known && data.runId && data.kind === 'delta') handle(async () => step(await look()));
    });
    // A safety net while nothing arrives (a step lost while reconnecting): read the record now and then.
    const watchdog = setInterval(() => { if (Date.now() - quiet > 10_000) { quiet = Date.now(); handle(async () => step(await look())); } }, 2500);
    const aborted = () => finish({ live: true });
    signal?.addEventListener('abort', aborted, { once: true });
    // The state as it is now first; then every change as it happens.
    // The record first (which run, which turn), then the stream from its start: this tab may have joined mid-way.
    stream.seq = 0; stream.state = emptyReply();
    handle(async () => { const done = await step(await look()); if (!done && runId) await catchUp(runId); return done; });
  });

  /**
   * Follow the run until this connection ends. Returns the settled reply when the run finishes inside the stream, or
   * `live: false` when this host cannot stream, so the caller asks again instead. A stream that came back at once is
   * not retried in a tight loop.
   */
  const follow = async () => {
    const opened = Date.now(), watch = new AbortController(), cut = () => watch.abort();
    signal?.addEventListener('abort', cut, { once: true }); unwatch = cut;
    // The account's socket connected meanwhile (a page that loaded mid-reply): leave this stream for it.
    const upgraded = live.on(message => { if (message.type === 'hello') cut(); });
    try {
      const response = await fetch('/api/pip/runs/stream?' + where() + '&after=' + cursor,
        { credentials: 'same-origin', headers: { accept: 'text/event-stream' }, signal: watch.signal }).catch(() => null);
      const type = String(response?.headers.get('content-type') || '');
      if (!response?.ok || !response.body || !type.includes('text/event-stream')) return { live: watch.signal.aborted };
      for await (const view of frames(response.body)) {
        if (Number.isSafeInteger(view.cursor) && view.cursor) cursor = view.cursor;
        const done = await step(view, true);
        if (done) return { live: true, done };
        if (watch.signal.aborted) break;
      }
      if (!watch.signal.aborted && Date.now() - opened < POLL) await wait(signal, POLL - (Date.now() - opened));
      return { live: true };
    } finally { upgraded(); signal?.removeEventListener('abort', cut); unwatch = () => {}; watch.abort(); }
  };

  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (Date.now() - changed > WAIT) throw new Error('The server reply is taking too long. It keeps running; open the chat again to see it.');
      const followed = failure ? { live: true } : live.connected() ? await followLive() : await follow();
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
    if (id) await command({ action: 'stop', accountId: owner.id, runId: id, device }).catch(() => {});
    throw new DOMException('Stopped', 'AbortError');
  }
}
