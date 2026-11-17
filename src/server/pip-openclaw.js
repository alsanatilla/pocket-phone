// Pip as a native OpenClaw agent (docs/pip-agent-runtime.md, "Native OpenClaw path"). OpenClaw owns the reply: the
// agent loop, the chat's session and history, compaction, memory, instructions, limits and loop detection. Pocket's
// server is an operator client of the gateway (the same WebSocket protocol OpenClaw's Control UI speaks, through the
// client OpenClaw exports) and adapts three things:
//
// - the reply: chat.send with only the person's message; the streamed agent events become the stored turn (answer,
//   activity rows, cards, phase) that the live socket and the UI already know.
// - the tools: the gateway's Pocket plugin (services/gateway/pocket-plugin) calls back into this process; a call is
//   answered only for a session a running reply registered, with that reply's account and access.
// - approvals: the plugin's before_tool_call asks for a plugin approval; Pocket shows it as a run request (the same
//   approval screen, decideRun) and resolves it with plugin.approval.resolve.
import { constants } from 'node:fs';
import { access, mkdir } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { agentForUser } from '../../services/gateway/sandbox.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCHEMAS } from '../client/pip-sdk-tools.js';
import { label, summary, sources } from '../client/pip-tools.js';
import { activity } from '../client/pip-activity.js';
import { cardFence, replaceCard } from '../shared/pocket-card-tool.js';
import { cardsIn } from '../shared/pocket-card-edit.js';
import { normalizeAnswer } from '../shared/pip-reply.js';
import { answerPieces, joinPieces, steerText } from '../shared/pip-steer.js';
import { NATIVE_TOOLS, NATIVE_WRITES, onWake } from './pip-openclaw-tools.js';
import { gatewayModelFor } from '../shared/pip-gateway-models.js';

/** Sessions with a reply running in this process, and the one gateway connection. One copy for the whole process. */
const state = globalThis.__pocketOpenClaw ??= { sessions: new Map(), connection: null, models: new Map() };
const no = (message, code = 'openclaw_failed') => Object.assign(new Error(message), { status: 502, code });
const stopped = () => Object.assign(new Error('Stopped'), { name: 'AbortError' });
/** How long a reply may go without a single event from the gateway (not counting a wait for the person). */
const IDLE = Number(process.env.PIP_OPENCLAW_IDLE_MS) || 120000;

/**
 * The OpenClaw session of one Pocket chat. Derived from the account as well as the chat, so a chat uid chosen to
 * match someone else's can never reach their session; Pocket keeps the reverse mapping only while a reply runs.
 */
export const sessionKeyFor = (userId, chatUid) => 'agent:' + agentForUser(userId) + ':pocket-' + createHash('sha256').update(userId + '\n' + chatUid).digest('hex').slice(0, 32);

/**
 * Where OpenClaw's gateway client keeps its device identity. One directory per Unix user: a diagnostic run as root
 * once left a root-owned 0700 directory behind, the web process (uid 1000) could not open it, and every reply failed
 * with "The OpenClaw gateway did not answer." after the handshake timed out. A directory another user owns may never
 * be reused, so the default is per-uid and the path is checked before the client starts.
 */
export const clientStateDir = () => process.env.PIP_OPENCLAW_CLIENT_STATE
  || join(tmpdir(), 'pocket-openclaw-client-' + (typeof process.getuid === 'function' ? process.getuid() : 'user'));
export async function prepareClientState() {
  const dir = clientStateDir();
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await access(dir, constants.W_OK | constants.X_OK);
  } catch (error) {
    throw no('Pip cannot use its gateway client directory ' + dir + ' (' + (error.code || error.message) + ').', 'openclaw_client_state');
  }
  return dir;
}

function dispatch(frame) {
  const payload = frame?.payload || {}, key = payload.sessionKey || payload.request?.sessionKey;
  const session = typeof key === 'string' && state.sessions.get(key);
  if (session) session.onEvent(frame.event, payload);
}

/** The gateway connection, opened once per process; OpenClaw's client reconnects by itself. */
export function gateway() {
  return state.connection ||= (async () => {
    const { GatewayClient } = await import('openclaw/plugin-sdk/gateway-runtime');
    // Fail with the directory's problem, not a 60-second handshake timeout, when it is not ours to write.
    const clientState = await prepareClientState();
    return await new Promise((resolve, reject) => {
      const client = new GatewayClient({ url: process.env.PIP_GATEWAY_WS || 'ws://127.0.0.1:' + (process.env.PIP_GATEWAY_PORT || '18789'), token: process.env.PIP_GATEWAY_TOKEN,
        // A trusted local backend on loopback with the shared token; Pocket renders tool events and plugin approvals.
        clientName: 'gateway-client', clientDisplayName: 'Pocket', mode: 'backend', role: 'operator',
        scopes: ['operator.read', 'operator.write', 'operator.approvals'], caps: ['tool-events', 'plugin-approvals'],
        // Its device identity lives apart from the gateway's own state.
        env: { ...process.env, OPENCLAW_STATE_DIR: clientState },
        onHelloOk: () => { clearTimeout(timer); resolve(client); },
        onEvent: dispatch,
        // Events lost while reconnecting cannot be replayed into a running reply: those replies fail and can be retried.
        onClose: () => { for (const session of state.sessions.values()) session.onEvent('pocket.closed', {}); } });
      const timer = setTimeout(() => { client.stop(); reject(no('The OpenClaw gateway did not answer.')); }, Number(process.env.PIP_OPENCLAW_CONNECT_MS) || 60000);
      client.start();
    });
  })().catch(error => { state.connection = null; throw error; });
}
/** For tests and shutdown: closes the connection. */
export async function closeGateway() {
  const pending = state.connection; state.connection = null;
  const client = await pending?.catch(() => null);
  await client?.stopAndWait?.({ timeoutMs: 2000 }).catch(() => {});
}

// --- The tool endpoint the plugin calls ---------------------------------------------------------------------------

/** One plugin request: run or preview a Pocket tool for the reply that owns the session, or refuse. */
export async function toolRequest(body) {
  const session = state.sessions.get(String(body?.sessionKey || ''));
  if (!session) {
    // A key that no reply owns is a bug in the key the gateway passes to the plugin, not a caller error. Name both
    // sides (session keys are not secrets) so the mismatch can be seen in production logs.
    console.log(JSON.stringify({ level: 'warn', message: 'Pocket tool called with an unknown session', given: String(body?.sessionKey || '').slice(0, 160), known: [...state.sessions.keys()].map(key => key.slice(0, 160)) }));
    return { error: 'session_unknown', message: 'Pocket is not running a reply in this conversation.' };
  }
  const tool = String(body.tool || ''), callId = String(body.callId || '');
  if (!NATIVE_TOOLS.includes(tool) || !callId) return { error: 'tool_unavailable', message: 'This tool is not offered here.' };
  if (body.action === 'preview') return session.preview(tool, body.input, callId);
  if (body.action === 'execute') return session.execute(tool, body.input, callId);
  return { error: 'invalid_request', message: 'Unknown request.' };
}

const sameToken = given => {
  const expected = Buffer.from(process.env.PIP_TOOLS_TOKEN || ''), value = Buffer.from(String(given || ''));
  return expected.length >= 16 && value.length === expected.length && timingSafeEqual(value, expected);
};
/** `/internal/pip-tools` on the web process: loopback only, the per-boot token, JSON in and out. */
export function toolsEndpoint(req, res, { forwardUrl } = {}) {
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  if (req.method !== 'POST' || !local || !sameToken(req.headers['x-pocket-tools'])) { res.writeHead(404).end(); return; }
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; if (raw.length > 1_000_000) req.destroy(); });
  req.on('end', async () => {
    let answer;
    try {
      const body = JSON.parse(raw);
      answer = await toolRequest(body);
      // The worker owns scheduled replies and queued assignments. Forward only an unknown session,
      // once, to the fixed loopback worker endpoint; the worker never forwards back.
      if (answer?.error === 'session_unknown' && forwardUrl) {
        const response = await fetch(forwardUrl, { method: 'POST', signal: AbortSignal.timeout(650000),
          headers: { 'content-type': 'application/json', 'x-pocket-tools': process.env.PIP_TOOLS_TOKEN || '' }, body: raw });
        if (!response.ok) throw new Error('The Pocket worker did not answer.');
        answer = await response.json();
      }
    }
    catch (error) { answer = { error: 'data_unavailable', message: String(error?.message || 'The tool failed.').slice(0, 300) }; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(answer ?? { error: 'data_unavailable', message: 'The tool returned nothing.' }));
  });
}

// --- One reply --------------------------------------------------------------------------------------------------

const CARD_TOOLS = ['show_card', 'update_card'];
/** Arguments as the activity keeps them: a card's are in the answer already (as pip-agent.js keeps them). */
const kept = (name, input) => CARD_TOOLS.includes(name) ? (name === 'update_card' ? JSON.stringify({ id: input?.id }) : '{}') : JSON.stringify(input ?? {});
const rowId = callId => 'oc-' + String(callId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 90);
const lookup = name => !CARD_TOOLS.includes(name) && !NATIVE_WRITES.includes(name) && !['create_job', 'change_job'].includes(name);
const joined = (before, after) => !after ? before : !before.trim() ? after : before.replace(/\s+$/, '') + '\n\n' + after.replace(/^\s+/, '');
/** The marks a changed card keeps: its pin and its threshold, with a new time. */
const marks = (id, old) => ({ id, updated: Date.now(), ...(old?.pinned ? { pinned: old.pinned } : {}), ...(old?.alert ? { alert: old.alert } : {}) });

/**
 * One chat reply on the gateway. `execute(name, input, signal, eventId)` and `preview(name, input, signal)` are
 * Pocket's tool runners for this account; `ask(request, signal)` puts a write to the person and resolves to
 * `{ approved }`; `take({ pos })` takes the messages sent into the reply; `onUpdate` receives the turn's progress.
 * Resolves to the finished turn fields; rejects with AbortError when stopped.
 */
export async function nativeReply({ userId, chatUid, runId, turn, chat, signal, execute, preview, ask, take = async () => [], saveTurn, allowedTools = NATIVE_TOOLS, autoApproveTools = [], waitingTools = [], message, createdAt = 0, onUpdate = () => {} }) {
  const timing = { start: Date.now(), created: Number(createdAt) || 0 };
  const client = await gateway(), key = sessionKeyFor(userId, chatUid);
  if (state.sessions.has(key)) throw no('Pip is already answering in this chat.', 'run_active');
  const result = { answer: '', reasoning: String(turn.reasoning || ''), activity: [], phase: 'requesting', usage: {} };
  // The answer is what earlier assistant items left (with the cards drawn between them) plus the item streaming now.
  let base = '', item = { id: '', text: '' }, outputs = 0, last = Date.now(), waiting = 0, sending = 0, finished = false;
  const active = new Set(), ended = new Set(), previews = new Map(), approved = new Set(), declined = new Set(), cards = new Map(), asks = new Set();
  const history = (chat?.turns || []).filter(entry => entry.uid !== turn.uid);
  const answer = () => joined(base, item.text);
  const publish = () => { result.answer = answer(); onUpdate({ answer: result.answer, reasoning: result.reasoning, activity: activity(result.activity), phase: result.phase, usage: { output_tokens: outputs } }); };
  const record = (callId, fields) => {
    const id = rowId(callId);
    let row = result.activity.find(entry => entry.id === id);
    if (!row) result.activity.push(row = { id, kind: 'tool', name: '', title: '', input: '', summary: '', sources: [], state: 'queued', started: Date.now(), ended: 0 });
    Object.assign(row, fields); publish();
    return row;
  };
  let settle, fail;
  const done = new Promise((resolve, reject) => { settle = resolve; fail = reject; });
  done.catch(() => {});
  const finish = error => {
    if (finished) return; finished = true;
    for (const controller of asks) controller.abort();
    if (error) fail(error); else settle();
  };
  // The reply is over when every run it follows ended and no message is still on its way into it.
  const check = () => { if (!active.size && !sending && ended.size) finish(); };

  /** A card the plugin drew, placed where the model called show_card: after the text streamed before the call. */
  const place = callId => {
    const card = cards.get(callId); if (!card) return;
    cards.delete(callId);
    base = joined(answer(), card) + '\n\n'; item = { id: item.id, text: '' }; publish();
  };
  /** update_card: the card changes where it stands, in this reply or an earlier one. */
  const revise = async ({ id, spec, shows }) => {
    const here = replaceCard(base, id, cardFence(spec, marks(id, cardsIn(base).find(card => card.id === id))));
    if (here !== null) { base = here; publish(); return { kind: 'card', updated: true, id, shows }; }
    for (const entry of history.toReversed()) {
      if (typeof entry.answer !== 'string') continue;
      const old = cardsIn(entry.answer).find(card => card.id === id);
      if (!old) continue;
      const changed = replaceCard(entry.answer, id, cardFence(spec, marks(id, old)));
      if (changed === null) continue;
      try { if (!saveTurn) throw new Error('unavailable'); await saveTurn({ ...entry, answer: changed, updated: Math.max(Date.now(), (entry.updated || 0) + 1) }); }
      catch { return { error: 'card_not_saved', message: 'The card could not be saved. Say so, and draw a new one with show_card if it matters.' }; }
      entry.answer = changed;
      return { kind: 'card', updated: true, id, shows, where: 'an earlier reply' };
    }
    return { error: 'card_not_found', message: 'No card with that id is in this chat.' };
  };

  const session = {
    async preview(tool, raw, callId) {
      if (!allowedTools.includes(tool)) return { error: 'access_disabled', message: 'This tool is not allowed in this run.' };
      const parsed = SCHEMAS[tool].safeParse(raw ?? {});
      if (!parsed.success) return { error: 'invalid_arguments', message: 'Correct the arguments or use an available tool.' };
      const ready = await preview(tool, parsed.data, signal);
      if (!ready || ready.error) return ready || { error: 'data_unavailable', message: 'This change could not be checked.' };
      previews.set(callId, { tool, input: parsed.data, ready });
      if (autoApproveTools.includes(tool)) { approved.add(callId); return { authorized: true }; }
      // Shown as the existing approval card; `frozen`: OpenClaw approves the arguments as proposed, so no editing.
      record(callId, { name: tool, title: label(tool, parsed.data), input: JSON.stringify(parsed.data), state: 'awaiting', summary: 'waiting for your approval',
        result: JSON.stringify({ kind: 'approval', frozen: true, ...ready }) });
      const title = ready.action?.title ? label(tool, parsed.data) + ' “' + ready.action.title + '”' : label(tool, parsed.data);
      return { title, description: 'Pip asks before it saves this in Pocket: ' + title + '.' };
    },
    async execute(tool, raw, callId) {
      if (!allowedTools.includes(tool)) return { error: 'access_disabled', message: 'This tool is not allowed in this run.' };
      last = Date.now();
      const parsed = SCHEMAS[tool].safeParse(raw ?? {});
      if (!parsed.success) return { error: 'invalid_arguments', message: 'Correct the arguments or use an available tool.' };
      // A save runs only after the person approved this very call, and only once.
      if (NATIVE_WRITES.includes(tool) && (previews.get(callId)?.tool !== tool || JSON.stringify(previews.get(callId)?.input) !== JSON.stringify(parsed.data) || !approved.delete(callId))) return { error: 'approval_required', message: 'The person has not approved this change.' };
      let out;
      const waits = waitingTools.includes(tool);
      if (waits) waiting++;
      try { out = await execute(tool, parsed.data, signal, rowId(callId)); }
      catch (error) { if (signal?.aborted) throw error; out = { error: 'data_unavailable', message: String(error?.message || 'The tool failed.').slice(0, 300) }; }
      finally { if (waits) { waiting--; last = Date.now(); } }
      if (tool === 'show_card' && out?.card) { cards.set(callId, out.card); return { kind: 'card', drawn: true, id: out.id, shows: out.shows }; }
      if (tool === 'update_card' && out?.revise) return revise(out);
      return out ?? { error: 'data_unavailable', message: 'The tool returned nothing.' };
    },
    onEvent(event, payload) {
      if (finished) return;
      last = Date.now();
      if (event === 'pocket.closed') { finish(no('The connection to the OpenClaw gateway dropped. Retry when you’re ready.')); return; }
      if (event === 'plugin.approval.requested') { approve(payload); return; }
      if (event === 'plugin.approval.resolved') { const id = payload.request?.toolCallId; if (id && !approved.has(id) && !declined.has(id)) for (const controller of asks) if (controller.callId === id) controller.abort(); return; }
      const runId = payload.runId;
      if (typeof runId === 'string' && !ended.has(runId)) active.add(runId);
      if (event === 'chat') {
        if (!['final', 'aborted', 'error'].includes(payload.state)) return;
        active.delete(runId); ended.add(runId);
        if (payload.state === 'error') finish(no(String(payload.errorMessage || 'The reply failed.').slice(0, 500)));
        else if (payload.state === 'aborted' && signal?.aborted) finish(stopped());
        else check();
        return;
      }
      if (event !== 'agent') return;
      const data = payload.data || {};
      if (payload.stream === 'assistant') {
        // `text` is the item's whole text so far, `delta` an append, `replace` a new text altogether.
        if (data.itemId && data.itemId !== item.id) { base = answer(); item = { id: data.itemId, text: '' }; }
        item.text = typeof data.text === 'string' ? data.text : data.replace ? String(data.delta || '') : item.text + String(data.delta || '');
        if (!timing.firstWord) timing.firstWord = Date.now();
        result.phase = 'writing'; publish();
      } else if (payload.stream === 'usage' && Number.isFinite(data.outputTokens)) outputs = data.outputTokens;
      else if (payload.stream === 'tool' && data.toolCallId) {
        const id = data.toolCallId, name = String(data.name || '');
        if (data.phase === 'start') {
          // Working notes before a lookup are not the answer (the in-process loop's rule): they move to the reasoning.
          if (lookup(name) && item.text.trim()) { result.reasoning = joined(result.reasoning, item.text); item = { id: item.id, text: '' }; }
          const row = result.activity.find(entry => entry.id === rowId(id));
          if (!row || !['awaiting', 'done'].includes(row.state)) record(id, { name, title: label(name, data.args || {}), input: kept(name, data.args), state: 'running' });
          result.phase = label(name, data.args || {}); publish();
        } else if (data.phase === 'result') {
          if (name === 'show_card') place(id);
          if (declined.has(id)) return;
          const details = data.result?.details, text = data.result?.content?.find?.(part => part.type === 'text')?.text;
          let out = details?.pocket;
          if (out === undefined) { try { out = JSON.parse(text); } catch { out = { text: String(text ?? '').slice(0, 4000) }; } }
          if (!out || typeof out !== 'object' || Array.isArray(out)) out = { value: out };
          const failed = data.isError || Boolean(out.error);
          const href = out.kind === 'action' && out.action?.status === 'saved' ? out.action.href : '';
          record(id, { name, state: failed ? 'failed' : 'done', summary: NATIVE_TOOLS.includes(name) ? summary(name, out) : failed ? 'failed' : 'done',
            result: JSON.stringify(out).slice(0, 8000), sources: NATIVE_TOOLS.includes(name) ? sources(name, out) : [], ended: Date.now(), ...(href ? { applied_href: href, applied: Date.now() } : {}) });
        }
      }
    },
  };

  /** A plugin approval for one of this reply's writes: put to the person as a run request, answered in OpenClaw. */
  const approve = async payload => {
    const callId = payload.request?.toolCallId, pending = previews.get(callId);
    if (!pending) { await client.request('plugin.approval.resolve', { id: payload.id, decision: 'deny' }).catch(() => {}); return; }
    const controller = Object.assign(new AbortController(), { callId });
    asks.add(controller); waiting++;
    let decision = null;
    try {
      decision = await ask({ approvalId: 'oc-' + String(payload.id).replace(/^plugin:/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 90), toolCallId: callId,
        toolName: pending.tool, input: pending.input, rowId: rowId(callId), preview: { ...pending.ready, frozen: true } }, controller.signal);
    } catch { decision = null; }
    finally { asks.delete(controller); waiting--; last = Date.now(); }
    if (finished) return;
    if (decision?.approved) approved.add(callId);
    else {
      declined.add(callId);
      record(callId, { state: 'done', summary: 'declined', ended: Date.now(), result: JSON.stringify({ message: 'The user declined this change.', kind: 'action', action: { ...pending.ready.action, status: 'declined' } }) });
    }
    result.phase = 'requesting'; publish();
    // An approval OpenClaw already closed (it timed out) is not resolved again; the call was blocked there.
    if (!controller.signal.aborted) await client.request('plugin.approval.resolve', { id: payload.id, decision: decision?.approved ? 'allow-once' : 'deny' }).catch(() => {});
  };

  /** Messages the person sent into this reply go to the running OpenClaw turn as steering, never while a change waits. */
  let pulling = false;
  const pull = async () => {
    if (pulling || finished || waiting) return;
    pulling = true;
    try {
      for (const message of await take({ pos: answer().length })) {
        sending++;
        try {
          const ack = await client.request('chat.send', { sessionKey: key, message: steerText(message.text), idempotencyKey: 'pocket-steer-' + message.uid, queueMode: 'steer' });
          // The turn ended just before: the gateway started a new one with the message, and this reply follows it.
          if (typeof ack?.runId === 'string' && !ended.has(ack.runId)) active.add(ack.runId);
        } finally { sending--; }
      }
    } catch { /* The message stays taken in the turn; the next pull tries the next one. */ }
    finally { pulling = false; check(); }
  };

  state.sessions.set(key, session);
  const offWake = onWake(runId, () => { pull(); });
  const onAbort = () => {
    client.request('chat.abort', { sessionKey: key }).catch(() => {});
    finish(stopped());
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setInterval(() => {
    pull();
    if (!waiting && Date.now() - last > IDLE) { client.request('chat.abort', { sessionKey: key }).catch(() => {}); finish(no('The reply stopped answering.')); }
  }, 1500);
  try {
    if (signal?.aborted) throw stopped();
    // Only the person's message and what they attached: the session holds everything before it.
    const context = (Array.isArray(turn.context) ? turn.context : []).map(source => '\n\n[Attached: ' + String(source.title || 'source') + ']\n' + String(source.text || '')).join('');
    // The chat's chosen model becomes this gateway session's override: switching a chat's model switches the model
    // here, on the next message. The gateway only accepts models its config carries (the OpenCode Go list).
    const wanted = gatewayModelFor(chat?.config);
    if (wanted && state.models.get(key) !== wanted) {
      try { await client.request('sessions.patch', { key, model: wanted }); state.models.set(key, wanted); }
      catch (error) { throw no('This chat’s model is not available on the server (' + wanted + '). Choose the model again in the chat.', 'model_unavailable'); }
    }
    timing.send = Date.now();
    const ack = await client.request('chat.send', { sessionKey: key, message: String(message ?? turn.text ?? '') + context, idempotencyKey: 'pocket-' + runId });
    timing.accepted = Date.now();
    if (typeof ack?.runId === 'string' && !ended.has(ack.runId)) active.add(ack.runId);
    await done;
  } finally {
    // One line per reply: where the time to the first word went (Pocket before the send, the gateway and model after).
    const at = name => timing[name] ? timing[name] - timing.start : null;
    console.log(JSON.stringify({ level: 'info', message: 'Native reply timing', runId, sinceRun: timing.created ? timing.start - timing.created : null, send: at('send'), accepted: at('accepted'), firstWord: at('firstWord'), done: Date.now() - timing.start }));
    clearInterval(timer); offWake();
    signal?.removeEventListener('abort', onAbort);
    if (state.sessions.get(key) === session) state.sessions.delete(key);
    finished = true;
    for (const controller of asks) controller.abort();
  }
  // The stored answer is normalized piece by piece around the messages taken into it, so each keeps its place.
  const { answer: stored, steers } = joinPieces(answerPieces(answer(), turn.steers), turn.steers, normalizeAnswer);
  return { answer: stored, ...(steers.length ? { steers } : {}), reasoning: result.reasoning, activity: activity(result.activity), phase: 'done', usage: { output_tokens: outputs } };
}
