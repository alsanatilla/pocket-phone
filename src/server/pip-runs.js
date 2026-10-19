import { randomUUID } from 'node:crypto';
import { database, execute as sql } from './database.js';
import { open } from './secrets.js';
import { writeObject } from './objects.js';
import { serverRecordSource } from './pip-source.js';
import { applyApprovedWrite } from './pip-writes.js';
import { backgroundAccount, chargeTokens, localDay, tokensLeft, validTimezone, JOB_BUDGET } from './pip-background.js';
import { readKey } from './pip-keys.js';
import { config as pipConfig, requestBody, contextCoverage } from '../client/pip-core.js';
import { execute as runTool, preview as previewTool, WRITE_TOOLS } from '../client/pip-tools.js';
import { settle } from '../client/pip-activity.js';
import { objectId, validObject } from '../shared/objects.js';

// Pip's shared conversations: the account's server runs each turn once for every device. A run holds its own
// provider messages and budgets, so it can stop at a change waiting for approval and continue in a later
// request, from any device, without a worker waiting. The account's synced records are the tool source and
// approved writes are applied here, exactly once, by a stable per-row id.
//
// A run is either executed by the one request holding its lease, which a heartbeat renews, or paused with no
// lease. Every write an executing request makes is conditional on its lease, so a request that lost the run
// (it was stopped, or presumed dead and ended) can never overwrite what happened since.
//
// One request runs one stretch of a reply within the function's 300-second limit. A stop from another device takes
// effect within a heartbeat; the lease outlives several missed ones, so a request that died is noticed within 20 seconds.
const RUN_DEADLINE = 150000, HEARTBEAT = 2000, LEASE = 20000, PROGRESS = 700, WAIT_TTL = 12 * 3600000, DEVICE_ANSWER = 16000;
/** A chat run on a vaulted key has no dedicated daily budget; this bounds a runaway day without a settings page. */
const VAULT_TOKENS = 200000;
const ACTIVE = ['running', 'awaiting', 'stopping'];
/** Tools a device may answer instead of the server: sources that can live only on that device. */
const DEVICE_TOOLS = ['search_calendar'];
const USAGE = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const STOPPED = 'Stopped. Continue or retry when you’re ready.', INTERRUPTED = 'The server stopped while writing this reply. Retry when you’re ready.';
const NOTE = '\n\nThis reply runs on your Pocket account\'s server and is shared by your devices: another device sees the same answer, tool activity and any change waiting for approval, and answers it once. Provider keys stay on the server for this chat. Notes, tasks, thoughts, calendar, gym and COROS come from your synced account copy.';
const no = (message, status = 400) => Object.assign(new Error(message), { status });
const allowedId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const parse = raw => { try { return JSON.parse(String(raw)); } catch { return null; } };

/**
 * Where a run's key and settings come from. The dedicated “on its own” key covers scheduled routines and shared
 * runs alike; without it, a signed-in chat may still run here with the key it stored in the account vault,
 * using the model that chat uses, the access its client asked for, and today's date in the client's timezone.
 */
async function account(userId, config = null, grants = [], timezone = '') {
  const saved = await backgroundAccount(userId);
  if (saved?.credentials && saved.settings) return { ...saved, key: open(userId, saved.credentials).key, source: 'routines' };
  if (!config) return null;
  const key = await readKey(userId, { provider: config.provider, baseUrl: config.baseUrl }).catch(() => '');
  if (!key) return null;
  return { key, source: 'vault', settings: { ...pipConfig(config), grants: serverGrants({ grants }), dailyTokens: VAULT_TOKENS, timezone: validTimezone(timezone) ? timezone : 'UTC', enabled: true } };
}
/** What the server may read for a shared run: the account's server grants, and calendar from its synced copy. */
export const serverGrants = settings => [...new Set([...(settings.grants || []), 'calendar'])];
/** The endpoint a chat's key would be stored under, or null when the client did not name a usable one. */
const chatEndpoint = value => value && ['anthropic', 'compatible'].includes(value.provider) ? { provider: value.provider, baseUrl: String(value.baseUrl || '') } : null;
/** A run reads only what the submitting chat allows, within what the account allows on the server. */
function runValue(settings, requested) {
  const allowed = serverGrants(settings), asked = Array.isArray(requested) ? requested : allowed;
  return { ...pipConfig(settings), grants: allowed.filter(grant => asked.includes(grant)) };
}
/**
 * What a client needs to know before it submits: whether the server holds a key, what it may read, today's budget.
 * The tab sends its own chat config along, because a chat that is new on this device has not reached the synced
 * copy yet — and the account's key may live in the vault for exactly that endpoint.
 */
export async function serverRunState(userId, chat = '', asked = null) {
  const saved = await account(userId);
  let available = Boolean(saved), settings = saved?.settings || null;
  let target = chatEndpoint(asked);
  if (!available && !target && chat && objectId(chat)) target = chatEndpoint((await chatObject(userId, chat))?.config);
  if (!available && target) {
    const key = await readKey(userId, target).catch(() => '');
    if (key) { available = true; settings = { ...target, webSearch: Boolean(asked?.webSearch), grants: [], dailyTokens: VAULT_TOKENS, timezone: 'UTC', enabled: true }; }
  }
  const row = chat && objectId(chat)
    ? (await sql({ sql: 'SELECT * FROM pocket_pip_runs WHERE user_id = ? AND chat_uid = ? ORDER BY created DESC LIMIT 1', args: [userId, chat] })).rows[0]
    : (await sql({ sql: 'SELECT * FROM pocket_pip_runs WHERE user_id = ? ORDER BY created DESC LIMIT 1', args: [userId] })).rows[0];
  return { available, grants: settings ? serverGrants(settings) : [], web: Boolean(settings?.webSearch),
    tokensLeft: saved ? Math.max(0, tokensLeft(saved)) : (available ? VAULT_TOKENS : 0), run: row ? await view(userId, await recover(userId, row), 0) : null };
}

const runRow = async (userId, runId) => (await sql({ sql: 'SELECT * FROM pocket_pip_runs WHERE user_id = ? AND run_id = ?', args: [userId, runId] })).rows[0] || null;
/** The run a client's request id started. The client knows this id before its submit answers. */
const requestRow = async (userId, requestId) => (await sql({ sql: 'SELECT * FROM pocket_pip_runs WHERE user_id = ? AND request_id = ?', args: [userId, requestId] })).rows[0] || null;
const chatObject = async (userId, uid) => {
  const row = (await sql({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0];
  return row ? parse(row.payload) : null;
};
async function conversation(userId, uid, header, value, now) {
  const stored = await chatObject(userId, uid);
  if (stored?.deleted) throw no('This chat was removed.', 404);
  if (stored) return stored;
  const config = (() => { try { return pipConfig(header?.config); } catch { return pipConfig(value); } })();
  return { uid, title: String(header?.title || 'Pip').slice(0, 64), created: Number.isSafeInteger(header?.created) ? header.created : now,
    updated: now, draft: '', context: [], turns: [], config };
}
const event = (userId, runId, kind, data = {}, now = Date.now()) =>
  sql({ sql: 'INSERT INTO pocket_pip_run_events (user_id, run_id, kind, data, created) VALUES (?, ?, ?, ?, ?)', args: [userId, runId, kind, JSON.stringify(data), now] });
/** The turn as the synced chat shows it. A later stamp than any copy a device holds lets this version win the merge. */
async function writeTurn(userId, uid, turn) {
  try {
    const chat = await chatObject(userId, uid);
    if (!chat || chat.deleted) return false;
    const stamp = Math.max(Date.now(), chat.updated + 1, (turn.updated || 0) + 1);
    turn.updated = stamp;
    await writeObject(userId, 'chats', { ...chat, updated: stamp, turns: [turn] }, { appendTurns: true });
    return true;
  } catch { return false; }
}
/** The chat's own name, in the synced copy every device reads. The later stamp wins the merge; its turns stay. */
async function writeTitle(userId, uid, title) {
  try {
    const chat = await chatObject(userId, uid);
    if (!chat || chat.deleted) return false;
    await writeObject(userId, 'chats', { ...chat, title: String(title).slice(0, 64), updated: Math.max(Date.now(), chat.updated + 1) });
    return true;
  } catch { return false; }
}
function endTurn(turn, status, error) {
  const value = turn || {};
  value.status = status; value.phase = status === 'done' ? 'done' : status === 'stopped' ? 'stopped' : 'failed';
  if (status !== 'done') value.error = value.error || error;
  value.activity = settle(value.activity || [], status === 'stopped' ? 'stopped' : 'failed', status === 'stopped' ? 'Stopped' : error);
  return value;
}
/** Ends a run this request owns. False when it no longer does: a stop or recovery ended it already. */
async function closeRun(userId, runId, leaseId, status, turn, data = {}) {
  const row = (await sql({ sql: `UPDATE pocket_pip_runs SET status = ?, turn = ?, checkpoint = NULL, lease_id = '', lease_until = 0, updated = ?
    WHERE user_id = ? AND run_id = ? AND lease_id = ? AND status IN ('running', 'stopping') RETURNING chat_uid`, args: [status, JSON.stringify(turn), Date.now(), userId, runId, leaseId] })).rows[0];
  if (!row) return false;
  const saved = await writeTurn(userId, String(row.chat_uid), turn);
  await event(userId, runId, status, { ...data, ...(saved ? {} : { chat: 'not_saved' }) });
  return true;
}
/**
 * Ends a run no request is executing. A stop ends a waiting run; recovery ends a run whose request died, which
 * the lease shows. Its open requests are dropped so they cannot be answered later.
 */
async function endIdle(userId, run, { stop = false, device = '' } = {}) {
  const now = Date.now(), stopping = stop || String(run.status) === 'stopping', status = stopping ? 'stopped' : 'failed';
  const turn = endTurn(parse(run.turn), status, stopping ? STOPPED : INTERRUPTED);
  const row = (await sql({ sql: `UPDATE pocket_pip_runs SET status = ?, turn = ?, checkpoint = NULL, lease_id = '', lease_until = 0, updated = ?
    WHERE user_id = ? AND run_id = ? AND (${stop ? "status = 'awaiting' OR " : ''}(status IN ('running', 'stopping') AND lease_until <= ?)) RETURNING *`,
    args: [status, JSON.stringify(turn), now, userId, String(run.run_id), now] })).rows[0];
  if (!row) return null;
  await sql({ sql: "UPDATE pocket_pip_run_requests SET state = 'stopped', decided_by = ?, decided_at = ? WHERE user_id = ? AND run_id = ? AND state = 'pending'", args: [device, now, userId, String(run.run_id)] });
  const saved = await writeTurn(userId, String(row.chat_uid), turn);
  await event(userId, String(run.run_id), stopping ? 'stopped' : 'interrupted', { ...(device ? { device } : {}), ...(saved ? {} : { chat: 'not_saved' }) }, now);
  return row;
}
/** A run whose executing request died is ended as soon as anyone looks at it, instead of showing as running. */
async function recover(userId, run) {
  if (!run || !['running', 'stopping'].includes(String(run.status)) || Number(run.lease_until) > Date.now()) return run;
  return await endIdle(userId, run) || await runRow(userId, String(run.run_id));
}

/**
 * A new turn. `requestId` comes from the client, so a retried submit reuses the run it already started instead
 * of asking the model twice. Everything is checked before the run exists, so a refused submit leaves nothing behind.
 */
export async function submitRun(userId, body, { fetcher, now = Date.now() } = {}) {
  const requestId = String(body.requestId || ''), header = body.chat && typeof body.chat === 'object' ? body.chat : {}, uid = String(header.uid || body.chatUid || '');
  if (!allowedId(requestId)) throw no('A Pip run needs a request id.');
  if (!objectId(uid)) throw no('Open a Pip chat first.');
  const existing = await requestRow(userId, requestId);
  if (existing) return view(userId, await recover(userId, existing), 0);
  const text = String(body.text || '').trim();
  if (!text || text.length > 16000) throw no('Write a message, up to 16,000 characters.');
  // The key may come from the account's “on its own” settings or from the key vault for this chat's own endpoint.
  const clientConfig = (() => { try { return pipConfig(header?.config); } catch { return null; } })();
  const timezone = validTimezone(body.timezone) ? body.timezone : '';
  const saved = await account(userId, clientConfig, body.grants, timezone);
  if (!saved) throw no('Pip on the server is not set up for this account. Turn it on in “on its own” first.', 409);
  if (saved.source === 'routines' && tokensLeft(saved, now) <= 0) throw no('Today’s token limit for Pip on the server is used up.', 429);
  const value = { ...runValue(saved.settings, body.grants), timezone: saved.settings.timezone || 'UTC' }, chat = await conversation(userId, uid, header, value, now);
  if (chat.turns.length >= 1990) throw no('This chat is full. Start a new one.', 413);
  const device = String(body.device || '').slice(0, 100);
  // The client's attempt id is kept: a synced server turn then carries the same attempt the tab is running, so the
  // tab's own progress updates are not mistaken for another run's. The runtime marker travels with the turn, so
  // every device can show that this reply ran on the server.
  const attempt = typeof body.attempt === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(body.attempt) ? body.attempt : randomUUID();
  // The tab's own turn id is kept too, so the turn this run writes is the same turn the tab already shows
  // instead of a second copy of the same question.
  const turnUid = typeof body.turnUid === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(body.turnUid) ? body.turnUid : randomUUID();
  const turn = { uid: turnUid, text, context: Array.isArray(body.context) ? body.context : [], created: now, updated: now, owner: device || 'pocket-server', attempt,
    answer: '', reasoning: '', error: '', status: 'streaming', usage: { runtime: 'pocket-server' }, activity: [], sources: [], phase: 'requesting', model: value.model };
  if (!validObject('chats', { ...chat, updated: now, turns: [turn] })) throw no('Check the message and its attached sources: up to three, each with a title and up to 8,000 characters.');
  const active = (await sql({ sql: `SELECT * FROM pocket_pip_runs WHERE user_id = ? AND chat_uid = ? AND status IN ('running', 'awaiting', 'stopping')`, args: [userId, uid] })).rows[0];
  if (active && ACTIVE.includes(String((await recover(userId, active))?.status))) throw no('Let the current reply finish, or stop it first.', 409);
  const deviceTools = [...new Set((Array.isArray(body.deviceTools) ? body.deviceTools : []).filter(name => DEVICE_TOOLS.includes(name)))];
  const runId = randomUUID(), leaseId = randomUUID();
  let inserted;
  try {
    inserted = (await sql({ sql: `INSERT INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(user_id, request_id) DO NOTHING RETURNING *`,
      args: [userId, runId, uid, requestId, turn.uid, device, JSON.stringify(turn), JSON.stringify(value), JSON.stringify(deviceTools), leaseId, Date.now() + LEASE, now, now] })).rows[0];
  } catch (error) {
    // Another device started a reply in this conversation at the same moment.
    if (/UNIQUE constraint failed/i.test(String(error?.message))) throw no('Let the current reply finish, or stop it first.', 409);
    throw error;
  }
  if (!inserted) return view(userId, await recover(userId, await requestRow(userId, requestId)), 0);
  await event(userId, runId, 'started', { chat: uid, turn: turn.uid, device }, now);
  // Both devices see the question before the answer starts.
  try { await writeObject(userId, 'chats', { ...chat, updated: Math.max(now, chat.updated + 1), turns: [turn] }, { appendTurns: true }); }
  catch (error) { await closeRun(userId, runId, leaseId, 'failed', endTurn(turn, 'failed', String(error?.message || 'This chat could not be saved.').slice(0, 300))); throw error; }
  await drive(userId, inserted, leaseId, { fetcher });
  return view(userId, await runRow(userId, runId), 0);
}

/** One client's answer to a request: a write is approved (perhaps edited) or declined; a device returns its result. */
function decision(kind, body) {
  if (kind === 'write') {
    if (body.approved === false) return { state: 'declined', response: '' };
    if (body.approved !== true) throw no('Approve or decline this change.');
    if (body.input === undefined) return { state: 'approved', response: '' };
    const text = JSON.stringify(body.input);
    if (!body.input || typeof body.input !== 'object' || Array.isArray(body.input) || text.length > DEVICE_ANSWER) throw no('This edited change is invalid.');
    return { state: 'approved', response: text };
  }
  const result = body.approved === false ? { error: 'device_unavailable', message: 'The device could not answer this.' } : body.result;
  const text = JSON.stringify(result);
  if (!result || typeof result !== 'object' || Array.isArray(result) || text.length > DEVICE_ANSWER) throw no('Send the device’s result as an object, up to 16,000 characters.');
  return { state: 'answered', response: text };
}
/**
 * Settles what a run waits for. The conditional update settles each request once, so two devices answering at
 * the same time settle it once; the request whose answer settles the last one continues the run.
 */
export async function decideRun(userId, body, { fetcher } = {}) {
  const runId = String(body.runId || ''), requestId = String(body.requestId || ''), device = String(body.device || '').slice(0, 100);
  if (!allowedId(runId) || !allowedId(requestId)) throw no('This decision is incomplete.');
  if (!await runRow(userId, runId)) throw no('This run is no longer available.', 404);
  const request = (await sql({ sql: 'SELECT * FROM pocket_pip_run_requests WHERE user_id = ? AND run_id = ? AND request_id = ?', args: [userId, runId, requestId] })).rows[0];
  if (!request) throw no('This change is no longer waiting for a decision.', 409);
  const { state, response } = decision(String(request.kind), body), now = Date.now();
  const settled = (await sql({ sql: `UPDATE pocket_pip_run_requests SET state = ?, response = ?, decided_by = ?, decided_at = ?
    WHERE user_id = ? AND run_id = ? AND request_id = ? AND state = 'pending' RETURNING request_id`, args: [state, response, device, now, userId, runId, requestId] })).rows[0];
  if (settled) await event(userId, runId, 'decision', { request: requestId, state, device }, now);
  else {
    const kept = (await sql({ sql: 'SELECT state FROM pocket_pip_run_requests WHERE user_id = ? AND run_id = ? AND request_id = ?', args: [userId, runId, requestId] })).rows[0];
    // A stopped request stays stopped; one another device already answered keeps that answer, which the view shows.
    if (String(kept?.state) === 'stopped') throw no('This change is no longer waiting for a decision.', 409);
  }
  await continueRun(userId, runId, { fetcher });
  return view(userId, await recover(userId, await runRow(userId, runId)), 0);
}

/** Continues a waiting run whose requests are all settled. Any device may ask; one request wins the claim. */
export async function continueRun(userId, runId, { fetcher } = {}) {
  const leaseId = randomUUID(), now = Date.now();
  const claimed = (await sql({ sql: `UPDATE pocket_pip_runs SET status = 'running', lease_id = ?, lease_until = ?, updated = ?
    WHERE user_id = ? AND run_id = ? AND status = 'awaiting' AND NOT EXISTS (SELECT 1 FROM pocket_pip_run_requests r
      WHERE r.user_id = pocket_pip_runs.user_id AND r.run_id = pocket_pip_runs.run_id AND r.state = 'pending') RETURNING *`,
    args: [leaseId, now + LEASE, now, userId, runId] })).rows[0];
  if (!claimed) return false;
  await event(userId, runId, 'continued', {}, now);
  await drive(userId, claimed, leaseId, { fetcher });
  return true;
}

/**
 * Stops a run from any device. The request executing it notices within a heartbeat and ends it, keeping what it
 * wrote so far; a run nothing executes (waiting for a decision, or whose request died) ends here.
 */
export async function stopRun(userId, body) {
  const runId = String(body.runId || ''), device = String(body.device || '').slice(0, 100), now = Date.now();
  if (!allowedId(runId)) throw no('This run is incomplete.');
  const live = (await sql({ sql: `UPDATE pocket_pip_runs SET status = 'stopping', updated = ? WHERE user_id = ? AND run_id = ? AND status = 'running' AND lease_until > ? RETURNING run_id`,
    args: [now, userId, runId, now] })).rows[0];
  if (live) await event(userId, runId, 'stopping', { device }, now);
  else {
    const run = await runRow(userId, runId);
    if (!run) throw no('This run is no longer available.', 404);
    await endIdle(userId, run, { stop: true, device });
  }
  return view(userId, await runRow(userId, runId), 0);
}

const settled = requests => requests.filter(row => String(row.state) !== 'pending');
/** What the clients decided, keyed by the SDK's tool call id. A device tool is answered instead of approved. */
const settlementMap = requests => new Map(settled(requests).map(row => [String(row.call_id), String(row.kind) === 'device'
  ? { answer: parse(row.response) ?? { error: 'device_unavailable', message: 'The device did not answer.' } }
  : { approved: String(row.state) === 'approved', ...(String(row.state) === 'approved' && row.response ? { input: parse(row.response) } : {}) }]));

/**
 * Runs one stretch of a turn in this request: until it is answered, it pauses for a decision, it is stopped, or
 * the request loses its lease. Spent tokens count against the account's daily limit either way.
 */
async function drive(userId, run, leaseId, { fetcher }) {
  const runId = String(run.run_id), chatUid = String(run.chat_uid), turn = parse(run.turn), snapshot = parse(run.config), deviceTools = parse(run.device_tools) || [];
  const owned = 'user_id = ? AND run_id = ? AND lease_id = ?', ownedArgs = [userId, runId, leaseId];
  const controller = new AbortController();
  let stopRequested = false, leaseLost = false, paused = false, lastWrite = 0, trailing = null, writing = Promise.resolve(), beating = Promise.resolve(), saved = null, segment = {};
  // The heartbeat keeps the lease while this request works, and notices a stop from another device.
  const beat = async () => {
    const row = (await sql({ sql: `UPDATE pocket_pip_runs SET lease_until = ? WHERE ${owned} RETURNING status`, args: [Date.now() + LEASE, ...ownedArgs] })).rows[0];
    if (!row) { leaseLost = true; controller.abort(); }
    else if (String(row.status) === 'stopping') { stopRequested = true; controller.abort(); }
  };
  const timer = setInterval(() => { beating = beat().catch(() => { /* The next beat retries; the lease outlives a missed one. */ }); }, HEARTBEAT);
  const quiet = async () => { clearInterval(timer); clearTimeout(trailing); trailing = null; await beating; await writing; };
  // Live progress for watching devices: at most every PROGRESS ms, one write at a time, never failing the reply. An
  // update inside that window is written when the window ends, so a tool that starts and then works quietly still shows.
  const progress = () => {
    const early = PROGRESS - (Date.now() - lastWrite);
    if (early > 0) { trailing ||= setTimeout(() => { trailing = null; progress(); }, early); return; }
    lastWrite = Date.now();
    writing = writing.then(() => sql({ sql: `UPDATE pocket_pip_runs SET turn = ?, updated = ? WHERE ${owned}`, args: [JSON.stringify(turn), Date.now(), ...ownedArgs] })).catch(() => {});
  };
  // A reply continued across requests keeps adding to the same usage.
  const prior = Object.fromEntries(USAGE.map(name => [name, Number(turn.usage?.[name]) || 0]));
  const total = usage => ({ ...usage, ...Object.fromEntries(USAGE.map(name => [name, prior[name] + (Number(usage?.[name]) || 0)])) });
  const end = async (status, error = '') => {
    await quiet();
    if (status !== 'done') endTurn(turn, status, error);
    else Object.assign(turn, { status: 'done', phase: 'done' });
    return closeRun(userId, runId, leaseId, status, turn, error ? { error } : {});
  };
  // A pause and the requests it waits for are stored together, and only by the request that still owns the run.
  const pause = async state => {
    await quiet();
    const at = Date.now();
    turn.status = 'streaming'; turn.phase = (state.pending || []).every(item => !WRITE_TOOLS.includes(item.toolName)) ? 'waiting for your device' : 'waiting for your approval';
    let moved = false;
    const tx = await database().transaction('write');
    try {
      moved = (await tx.execute({ sql: `UPDATE pocket_pip_runs SET status = 'awaiting', checkpoint = ?, turn = ?, expires_at = ?, lease_id = '', lease_until = 0, updated = ? WHERE ${owned} AND status = 'running'`,
        args: [JSON.stringify(state), JSON.stringify(turn), at + WAIT_TTL, at, ...ownedArgs] })).rowsAffected > 0;
      if (moved) for (const item of state.pending || []) {
        const write = WRITE_TOOLS.includes(item.toolName);
        await tx.execute({ sql: `INSERT INTO pocket_pip_run_requests (user_id, run_id, request_id, kind, tool, call_id, row_id, payload, state, created)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?) ON CONFLICT(user_id, run_id, request_id) DO NOTHING`,
          args: [userId, runId, item.approvalId || item.toolCallId, write ? 'write' : 'device', item.toolName, item.toolCallId, item.rowId,
            JSON.stringify(write ? state.previews?.[item.toolCallId] || {} : { input: item.input }), at] });
      }
      await (moved ? tx.commit() : tx.rollback());
    } catch (error) { await tx.rollback().catch(() => {}); throw error; }
    finally { tx.close(); }
    if (!moved) {
      // Another device stopped the run just before it paused, or this request lost it.
      const row = await runRow(userId, runId);
      if (String(row?.lease_id) === leaseId && String(row?.status) === 'stopping') stopRequested = true; else leaseLost = true;
      return;
    }
    paused = true;
    await writeTurn(userId, chatUid, turn);
    await event(userId, runId, 'awaiting', { requests: (state.pending || []).map(item => ({ id: item.approvalId || item.toolCallId, tool: item.toolName, kind: WRITE_TOOLS.includes(item.toolName) ? 'write' : 'device' })) }, at);
  };
  try {
    saved = await account(userId, snapshot, snapshot.grants, snapshot.timezone);
    if (!saved) return await end('failed', 'Pip on the server is no longer set up for this account.');
    // The provider and model stay as the reply started, so its reasoning continues; access is what the account allows now.
    const value = { ...snapshot, grants: (snapshot.grants || []).filter(grant => serverGrants(saved.settings).includes(grant)) };
    const chat = await chatObject(userId, chatUid);
    if (!chat || chat.deleted) return await end('stopped', 'This chat was removed.');
    const key = saved.key, timezone = value.timezone || saved.settings.timezone || 'UTC';
    const conversationView = { ...chat, config: value }, body = requestBody(conversationView, turn), source = await serverRecordSource(userId);
    body.instructions += '\n\nToday is ' + localDay(Date.now(), timezone) + ' (' + timezone + ').' + NOTE;
    const requests = (await sql({ sql: 'SELECT * FROM pocket_pip_run_requests WHERE user_id = ? AND run_id = ? ORDER BY created', args: [userId, runId] })).rows;
    const resumed = parse(run.checkpoint);
    // A continued run keeps the completed lookups as reusable observations.
    const observations = (turn.activity || []).filter(row => row.state === 'done' && row.result && !row.applied_href)
      .map(row => ({ name: row.name, input: row.input || '{}', result: row.result })).slice(-24);
    const { streamChat } = await import('../client/pip-stream.js');
    const reply = await streamChat(conversationView, turn, { value, body, key, fetcher, deadlineMs: RUN_DEADLINE, deviceTools, signal: controller.signal, coverage: contextCoverage(conversationView, turn),
      onUpdate: update => { segment = update.usage || segment; Object.assign(turn, update, { usage: { ...total(segment), runtime: 'pocket-server' } }); progress(); },
      resume: { reasoning: turn.reasoning || '', activity: turn.activity || [], observations },
      durable: { checkpoint: resumed, settled: resumed ? settlementMap(requests) : null, pause },
      executeTool: async (value, name, input, signal, context) => {
        const answer = WRITE_TOOLS.includes(name)
          ? applyApprovedWrite(userId, { chatId: chatUid, turnId: turn.uid, eventId: context.eventId, name, input })
          : await runTool(value, name, input, signal, { ...context, source });
        // A name belongs to the chat, not the turn: write it into the synced conversation so every device agrees.
        if (answer?.kind === 'chat' && answer.title) await writeTitle(userId, chatUid, answer.title);
        return answer;
      },
      previewTool: (value, name, input, signal) => previewTool(value, name, input, signal, source) });
    segment = reply.usage || segment;
    Object.assign(turn, reply, { usage: { ...total(segment), runtime: 'pocket-server' } });
    await end('done');
  } catch (error) {
    if (error?.name === 'RunPaused' && paused || leaseLost) return;
    if (stopRequested) await end('stopped', STOPPED);
    else await end('failed', String(error?.message || 'The reply could not be completed.').slice(0, 500));
  } finally {
    await quiet();
    const spent = (Number(segment.input_tokens) || 0) + (Number(segment.output_tokens) || 0);
    if (saved && spent) await chargeTokens(userId, saved.settings.timezone, spent).catch(() => { /* The run's own usage still shows it. */ });
  }
}

/**
 * The scheduled job's part: runs whose request died end; requests nobody answered within WAIT_TTL are settled
 * with what the model can know (a declined change, no device answer); and waiting runs whose requests are all
 * settled continue, while this call has time for a whole stretch.
 */
export async function sweepRuns({ fetcher, now = Date.now(), deadline = Date.now() + JOB_BUDGET } = {}) {
  let interrupted = 0, expired = 0, continued = 0, more = false;
  for (const row of (await sql({ sql: "SELECT * FROM pocket_pip_runs WHERE status IN ('running', 'stopping') AND lease_until <= ? LIMIT 50", args: [Date.now()] })).rows)
    if (['failed', 'stopped'].includes(String((await recover(String(row.user_id), row))?.status))) interrupted++;
  const unanswered = JSON.stringify({ error: 'device_unavailable', message: 'The device did not answer in time; use what you already have.' });
  for (const row of (await sql({ sql: "SELECT user_id, run_id FROM pocket_pip_runs WHERE status = 'awaiting' AND expires_at > 0 AND expires_at <= ? LIMIT 50", args: [now] })).rows) {
    const userId = String(row.user_id), runId = String(row.run_id);
    const open = (await sql({ sql: `UPDATE pocket_pip_run_requests SET state = CASE WHEN kind = 'device' THEN 'answered' ELSE 'declined' END,
      response = CASE WHEN kind = 'device' THEN ? ELSE '' END, decided_by = 'expiry', decided_at = ? WHERE user_id = ? AND run_id = ? AND state = 'pending' RETURNING request_id`,
      args: [unanswered, now, userId, runId] })).rows;
    if (open.length) { expired++; await event(userId, runId, 'expired', { requests: open.map(item => String(item.request_id)) }, now); }
  }
  const ready = (await sql({ sql: `SELECT user_id, run_id FROM pocket_pip_runs WHERE status = 'awaiting' AND NOT EXISTS (SELECT 1 FROM pocket_pip_run_requests r
    WHERE r.user_id = pocket_pip_runs.user_id AND r.run_id = pocket_pip_runs.run_id AND r.state = 'pending') ORDER BY updated LIMIT 20` })).rows;
  for (const row of ready) {
    if (Date.now() + RUN_DEADLINE > deadline) { more = true; break; }
    try { if (await continueRun(String(row.user_id), String(row.run_id), { fetcher })) continued++; } catch { /* The next sweep retries. */ }
  }
  return { interrupted, expired, continued, more };
}

/** What a client shows: the run, what it waits for, and the events since its cursor. */
export async function runView(userId, { runId = '', request = '', chat = '', after = 0 } = {}) {
  const cursor = Number.isSafeInteger(Number(after)) && Number(after) > 0 ? Number(after) : 0;
  const row = runId && allowedId(runId) ? await runRow(userId, runId)
    : request && allowedId(request) ? await requestRow(userId, request)
    : (await sql({ sql: `SELECT * FROM pocket_pip_runs WHERE user_id = ? ${chat && objectId(chat) ? 'AND chat_uid = ?' : ''} AND status IN ('running', 'awaiting', 'stopping') ORDER BY created DESC LIMIT 1`,
      args: chat && objectId(chat) ? [userId, chat] : [userId] })).rows[0];
  return view(userId, await recover(userId, row), cursor);
}

/** How a follower watches: a tick that re-reads the run, a ping so idle proxies stay open, and one connection's life. */
const STREAM_TICK = 250, STREAM_PING = 15000, STREAM_TTL = 45000;
const idle = (ms, signal) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener?.('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * The same view runView returns, pushed as it changes: a tab that follows a run sees the answer grow, its phases and
 * an approval arrive as they happen, instead of asking again every 700 ms. Frames stop when the run settles, when the
 * connection is dropped, or after STREAM_TTL — a host that cuts a long connection then costs nothing, because the
 * follower reconnects with its own event cursor. `null` is a keep-alive, not a change.
 *
 * The submitting tab follows by its own request id while its submit is still running the reply, so it may ask before
 * that run exists: it then waits for the run instead of being told there is none.
 */
export async function* runFrames(userId, { runId = '', request = '', chat = '', after = 0, ttl = STREAM_TTL, signal = null } = {}) {
  let cursor = Number.isSafeInteger(Number(after)) && Number(after) > 0 ? Number(after) : 0;
  const started = Date.now(), expected = Boolean(request && !runId);
  let seen = '', sent = Date.now();
  for (;;) {
    const current = await runView(userId, { runId, request, chat, after: cursor });
    const run = current.run;
    if (!run && !expected) { yield current; return; }
    if (run) {
      cursor = Number(current.cursor) || cursor;
      const mark = JSON.stringify([run.status, run.turn, current.requests]);
      if (mark !== seen) { seen = mark; sent = Date.now(); yield current; }
      if (!ACTIVE.includes(String(run.status))) return;
    }
    if (Date.now() - started >= ttl) return;
    await idle(STREAM_TICK, signal);
    if (signal?.aborted) return;
    if (Date.now() - sent >= STREAM_PING) { sent = Date.now(); yield null; }
  }
}


async function view(userId, run, cursor = 0) {
  if (!run) return { run: null, requests: [], events: [], cursor };
  const requests = (await sql({ sql: 'SELECT * FROM pocket_pip_run_requests WHERE user_id = ? AND run_id = ? ORDER BY created', args: [userId, String(run.run_id)] })).rows
    .map(row => ({ id: String(row.request_id), row: String(row.row_id), kind: String(row.kind), tool: String(row.tool), state: String(row.state), payload: parse(row.payload), response: row.response ? parse(row.response) : null, by: String(row.decided_by || ''), at: Number(row.decided_at) || 0 }));
  const events = (await sql({ sql: 'SELECT seq, kind, data, created FROM pocket_pip_run_events WHERE user_id = ? AND run_id = ? AND seq > ? ORDER BY seq LIMIT 200', args: [userId, String(run.run_id), cursor] })).rows
    .map(row => ({ seq: Number(row.seq), kind: String(row.kind), data: parse(row.data), at: Number(row.created) }));
  return { run: {
    runId: String(run.run_id), chat: String(run.chat_uid), turnUid: String(run.turn_uid), requestId: String(run.request_id), device: String(run.device || ''),
    status: String(run.status), turn: parse(run.turn), created: Number(run.created), updated: Number(run.updated), expiresAt: Number(run.expires_at) || 0
  }, requests, events, cursor: events.length ? events.at(-1).seq : cursor };
}
