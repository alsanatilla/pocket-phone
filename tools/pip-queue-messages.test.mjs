import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleMessage, response } from './pip-provider-fixtures.mjs';

// A message sent while Pip replies waits its turn (docs/pip-message-flow.md, last section): against a real libSQL
// file and a provider double, as in pip-runs.test.mjs. Each test uses its own account and leaves no waiting or
// running run behind, because the sweep looks at every account.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-queue-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments } = await import('../src/server/workspace.js');
const { saveBackground } = await import('../src/server/pip-background.js');
const { writeObject } = await import('../src/server/objects.js');
const { subscribe } = await import('../src/server/pocket-events.js');
const runs = await import('../src/server/pip-runs.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const SETTINGS = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
const CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
let users = 0;
async function account() {
  const id = 'queue-user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes: [] }, 'agenda.json': { v: 1, events: [] } });
  await saveBackground(id, SETTINGS, 'fixture-key-123456');
  return id;
}
const header = (uid, extra = {}) => ({ uid, title: 'Queue', created: Date.now(), config: CONFIG, ...extra });
const chatOf = async (userId, uid) => {
  const row = (await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0];
  return row ? JSON.parse(String(row.payload)) : null;
};
const send = (userId, chat, requestId, text, fetcher, extra = {}) => runs.submitRun(userId, { requestId, chat: header(chat, extra.header), text, device: 'phone-1', ...extra.body }, { fetcher });
/** What the person asked in this request: the last user message, without the activity record Pocket puts before it. */
const lastAsked = request => String(request.messages.filter(message => message.role === 'user').at(-1)?.content || '').split('Current user request:\n').at(-1);
const failure = (status, message) => new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), { status, headers: { 'content-type': 'application/json' } });

/**
 * A provider double for a chat that answers one message after another: it answers "Answer to <message>." and records
 * which message each request asked. `hold` keeps the first request open until `release()`; `fail` names messages
 * the provider refuses.
 */
function model({ hold = false, fail = [], write = [] } = {}) {
  const asked = [];
  let release, begun;
  const held = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { begun = resolve; });
  const fetcher = async (url, options) => {
    const request = JSON.parse(options.body), text = lastAsked(request);
    asked.push(text);
    // The held request ends like a real one when the run is stopped: its signal aborts it.
    if (asked.length === 1) {
      begun();
      if (hold) await new Promise((resolve, reject) => { held.then(resolve); options.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }); });
    }
    if (fail.includes(text)) return failure(400, 'The fixture refuses this message.');
    if (write.includes(text) && !request.messages.some(message => message.role === 'tool')) return response(compatibleMessage({ calls: [{ name: 'create_record', input: { kind: 'note', title: 'Blue car', text: '21,000 euros' }, id: 'call_write' }] }));
    return response(compatibleMessage({ text: 'Answer to ' + text + '.' }));
  };
  return { fetcher, asked, release: () => release(), started };
}
/** A reply waiting for an approval, so the chat stays busy without a request holding it. */
async function awaiting(userId, chat, m) {
  const view = await send(userId, chat, 'req-' + chat + '-1', 'Save the blue car.', m.fetcher);
  assert.equal(view.run.status, 'awaiting', view.run.turn.error);
  return view;
}

test('1 · a message sent while Pip replies is accepted, waits in the queue, and can be taken back until it starts', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'] });
  const first = await awaiting(userId, 'chat-take', m);
  const second = await send(userId, 'chat-take', 'req-take-2', 'And the red one?', m.fetcher);
  const third = await send(userId, 'chat-take', 'req-take-3', 'Which is cheaper?', m.fetcher);
  assert.equal(second.run.status, 'waiting'); assert.equal(third.run.status, 'waiting');
  // Nothing is in the chat yet: it is written when it starts, in the segment chosen then.
  assert.equal((await chatOf(userId, 'chat-take')).turns.length, 1);
  const queue = await runs.queueView(userId, { chat: 'chat-take' });
  assert.deepEqual(queue.queue.map(item => [item.text, item.state]), [['And the red one?', 'waiting'], ['Which is cheaper?', 'waiting']]);
  assert.equal(queue.active, 'awaiting');
  const after = await runs.changeQueue(userId, { action: 'withdraw', runId: second.run.runId });
  assert.deepEqual(after.queue.map(item => item.text), ['Which is cheaper?']);
  // Taking it back twice is the same as once.
  assert.deepEqual((await runs.changeQueue(userId, { action: 'withdraw', runId: second.run.runId })).queue.map(item => item.text), ['Which is cheaper?']);
  await runs.decideRun(userId, { runId: first.run.runId, requestId: first.requests[0].id, approved: false, device: 'phone-1' }, { fetcher: m.fetcher });
  assert.deepEqual(m.asked.filter(text => text !== 'Save the blue car.'), ['Which is cheaper?'], 'the withdrawn message never reached the model');
  assert.deepEqual((await chatOf(userId, 'chat-take')).turns.map(turn => turn.text), ['Save the blue car.', 'Which is cheaper?']);
  // A message that has started can no longer be taken back.
  const started = await runs.changeQueue(userId, { action: 'withdraw', runId: third.run.runId });
  assert.equal(started.queue.length, 0);
  assert.equal((await runs.runView(userId, { runId: third.run.runId })).run.status, 'done');
});

test('2 · when the reply ends the oldest message starts by itself, and three run one after another in the order sent', async () => {
  const userId = await account(), m = model({ hold: true });
  const running = send(userId, 'chat-order', 'req-order-1', 'One', m.fetcher);
  await m.started;
  for (const [index, text] of ['Two', 'Three', 'Four'].entries()) assert.equal((await send(userId, 'chat-order', 'req-order-' + (index + 2), text, m.fetcher)).run.status, 'waiting');
  m.release();
  await running;
  const chat = await chatOf(userId, 'chat-order');
  assert.deepEqual(chat.turns.map(turn => [turn.text, turn.status, turn.answer]),
    [['One', 'done', 'Answer to One.'], ['Two', 'done', 'Answer to Two.'], ['Three', 'done', 'Answer to Three.'], ['Four', 'done', 'Answer to Four.']]);
  assert.deepEqual(m.asked, ['One', 'Two', 'Three', 'Four']);
  // Each one started after the one before had ended, and read its answer.
  const ends = [];
  for (const id of ['req-order-1', 'req-order-2', 'req-order-3', 'req-order-4']) {
    const view = await runs.runView(userId, { request: id });
    ends.push([view.events.find(item => item.kind === 'started').at, view.events.find(item => item.kind === 'done').at]);
  }
  for (let index = 1; index < ends.length; index++) assert.ok(ends[index][0] >= ends[index - 1][1], 'message ' + (index + 1) + ' started after the one before ended');
  assert.equal((await runs.queueView(userId, { chat: 'chat-order' })).queue.length, 0);
});

test('2 · a reply waiting for approval keeps the queue waiting until it is decided', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'] });
  const first = await awaiting(userId, 'chat-approve', m);
  await send(userId, 'chat-approve', 'req-approve-2', 'Then summarise my week.', m.fetcher);
  // Neither the sweep nor reading the queue starts it while the change waits.
  await runs.sweepRuns({ fetcher: m.fetcher });
  const queue = await runs.queueView(userId, { chat: 'chat-approve' });
  assert.deepEqual([queue.active, queue.queue.map(item => item.state)], ['awaiting', ['waiting']]);
  assert.deepEqual(m.asked, ['Save the blue car.']);
  await runs.decideRun(userId, { runId: first.run.runId, requestId: first.requests[0].id, approved: true, device: 'phone-1' }, { fetcher: m.fetcher });
  assert.deepEqual((await chatOf(userId, 'chat-approve')).turns.map(turn => [turn.text, turn.status]), [['Save the blue car.', 'done'], ['Then summarise my week.', 'done']]);
});

test('3 · a retried submit of a queued message is the same message, once', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'] });
  const first = await awaiting(userId, 'chat-retry', m);
  const sent = await send(userId, 'chat-retry', 'req-retry-2', 'Next one.', m.fetcher);
  const again = await send(userId, 'chat-retry', 'req-retry-2', 'Next one.', m.fetcher);
  assert.equal(again.run.runId, sent.run.runId);
  assert.equal((await runs.queueView(userId, { chat: 'chat-retry' })).queue.length, 1);
  await runs.decideRun(userId, { runId: first.run.runId, requestId: first.requests[0].id, approved: false }, { fetcher: m.fetcher });
  // Retried after it ran: still the same run, not a second answer.
  assert.equal((await send(userId, 'chat-retry', 'req-retry-2', 'Next one.', m.fetcher)).run.status, 'done');
  assert.deepEqual((await chatOf(userId, 'chat-retry')).turns.map(turn => turn.text), ['Save the blue car.', 'Next one.']);
  assert.equal(m.asked.filter(text => text === 'Next one.').length, 1);
});

test('3 · every device hears each change of the queue on the account’s live events', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'] }), heard = [];
  const stop = subscribe(userId, event => { if (event.type === 'run' && event.kind !== 'delta') heard.push([event.kind, event.chat]); });
  try {
    const first = await awaiting(userId, 'chat-events', m);
    const queued = await send(userId, 'chat-events', 'req-events-2', 'Later.', m.fetcher);
    await runs.changeQueue(userId, { action: 'withdraw', runId: queued.run.runId });
    await runs.stopRun(userId, { runId: first.run.runId, device: 'phone-1' });
  } finally { stop(); }
  assert.ok(heard.some(([kind, chat]) => kind === 'waiting' && chat === 'chat-events'));
  assert.ok(heard.some(([kind, chat]) => kind === 'withdrawn' && chat === 'chat-events'));
});

test('3 · a queue survives a restart: a reply that died is continued and the next message then starts', async () => {
  const userId = await account(), now = Date.now(), m = model();
  const turn = { uid: 'turn-died', text: 'First', context: [], created: now - 1000, updated: now - 1000, owner: 'phone-1', attempt: 'attempt-died', answer: 'Half', reasoning: '', error: '', status: 'streaming', usage: {}, activity: [], sources: [], phase: 'writing' };
  await writeObject(userId, 'chats', { ...header('chat-died'), updated: now, draft: '', context: [], turns: [turn] });
  // The process holding this reply is alive while the next message is sent, then stops.
  await execute({ sql: `INSERT INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
    VALUES (?, 'run-died', 'chat-died', 'req-died', 'turn-died', 'phone-1', 'running', ?, NULL, ?, '[]', 'lease-gone', ?, 0, ?, ?)`, args: [userId, JSON.stringify(turn), JSON.stringify({ ...CONFIG, grants: [], timezone: 'UTC' }), now + 60000, now, now] });
  assert.equal((await send(userId, 'chat-died', 'req-died-2', 'Second', m.fetcher)).run.status, 'waiting');
  await execute({ sql: "UPDATE pocket_pip_runs SET lease_until = ? WHERE user_id = ? AND run_id = 'run-died'", args: [now - 1000, userId] });
  // The worker's sweep in the next process: the dead reply is continued, then the waiting message runs.
  const swept = await runs.sweepRuns({ fetcher: m.fetcher });
  assert.equal(swept.restarted, 1);
  assert.deepEqual((await chatOf(userId, 'chat-died')).turns.map(item => [item.text, item.status]), [['First', 'done'], ['Second', 'done']]);
  assert.deepEqual(m.asked, ['First', 'Second']);
});

test('3 · a queue survives a restart between one reply’s end and the next start', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'] });
  const first = await awaiting(userId, 'chat-gap', m);
  await send(userId, 'chat-gap', 'req-gap-2', 'Two', m.fetcher);
  // The process ended the reply and stopped before it started the next message: the record is left as it left it.
  await execute({ sql: "UPDATE pocket_pip_runs SET status = 'done', lease_id = '', lease_until = 0 WHERE user_id = ? AND run_id = ?", args: [userId, first.run.runId] });
  assert.deepEqual((await runs.queueView(userId, { chat: 'chat-gap' })).queue.map(item => item.text), ['Two'], 'nothing started it yet');
  const swept = await runs.sweepRuns({ fetcher: m.fetcher });
  assert.equal(swept.advanced, 1);
  assert.equal((await runs.runView(userId, { request: 'req-gap-2' })).run.status, 'done');
  assert.deepEqual(m.asked, ['Save the blue car.', 'Two']);
});

test('3 · in the one big chat a queued message goes to the segment chosen when it starts; the reply stays in its own', async () => {
  const userId = await account(), now = Date.now(), m = model({ hold: true });
  const done = index => ({ uid: 'home-old-' + index, text: 'Q' + index, context: [], created: now - 100000 + index, updated: now - 100000 + index, owner: 'phone-1', attempt: 'a' + index, answer: 'A' + index + '.', reasoning: '', error: '', status: 'done', usage: {}, activity: [], sources: [], phase: 'done' });
  await writeObject(userId, 'chats', { uid: 'home-a', title: 'pip', titled: true, home: true, created: now - 200000, updated: now - 1000, draft: '', context: [], config: CONFIG, turns: Array.from({ length: 59 }, (_, index) => done(index)) });
  const home = { title: 'pip', titled: true, home: true };
  const running = send(userId, 'home-a', 'req-home-1', 'Sixtieth', m.fetcher, { header: home });
  await m.started;
  // Sent from a tab whose current segment is home-a: the reply there is the sixtieth turn and still runs.
  assert.equal((await send(userId, 'home-a', 'req-home-2', 'After the sixtieth', m.fetcher, { header: home })).run.status, 'waiting');
  m.release(); await running;
  const first = await chatOf(userId, 'home-a');
  assert.equal(first.turns.length, 60); assert.equal(first.turns.at(-1).text, 'Sixtieth'); assert.equal(first.turns.at(-1).status, 'done');
  const next = await runs.runView(userId, { request: 'req-home-2' });
  assert.notEqual(next.run.chat, 'home-a', 'the full segment does not take it');
  const second = await chatOf(userId, next.run.chat);
  assert.equal(second.home, true); assert.deepEqual(second.turns.map(turn => [turn.text, turn.status]), [['After the sixtieth', 'done']]);
});

test('4 · stop ends the running reply and pauses the queue; clear takes the paused messages back', async () => {
  const userId = await account(), m = model({ hold: true });
  const running = send(userId, 'chat-stop', 'req-stop-1', 'Long research', m.fetcher);
  await m.started;
  await send(userId, 'chat-stop', 'req-stop-2', 'Two', m.fetcher);
  await send(userId, 'chat-stop', 'req-stop-3', 'Three', m.fetcher);
  const live = await runs.runView(userId, { request: 'req-stop-1' });
  await runs.stopRun(userId, { runId: live.run.runId, device: 'phone-1' });
  // The request running the reply notices the stop at its next heartbeat.
  assert.equal((await running).run.status, 'stopped');
  const paused = await runs.queueView(userId, { chat: 'chat-stop' });
  assert.deepEqual([paused.active, paused.queue.map(item => [item.text, item.state])], ['', [['Two', 'held'], ['Three', 'held']]]);
  // Paused means paused: the sweep does not start them.
  await runs.sweepRuns({ fetcher: m.fetcher });
  assert.deepEqual(m.asked, ['Long research']);
  const cleared = await runs.changeQueue(userId, { action: 'clear', chat: 'chat-stop' });
  assert.equal(cleared.queue.length, 0);
  assert.deepEqual((await chatOf(userId, 'chat-stop')).turns.map(turn => [turn.text, turn.status]), [['Long research', 'stopped']]);
});

test('4 · resume lets paused messages run in order', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'] });
  const first = await awaiting(userId, 'chat-resume', m);
  await send(userId, 'chat-resume', 'req-resume-2', 'Two', m.fetcher);
  await send(userId, 'chat-resume', 'req-resume-3', 'Three', m.fetcher);
  await runs.stopRun(userId, { runId: first.run.runId, device: 'phone-1' });
  assert.deepEqual((await runs.queueView(userId, { chat: 'chat-resume' })).queue.map(item => item.state), ['held', 'held']);
  const resumed = await runs.changeQueue(userId, { action: 'resume', chat: 'chat-resume' }, { fetcher: m.fetcher });
  assert.equal(resumed.queue.length, 0);
  assert.deepEqual((await chatOf(userId, 'chat-resume')).turns.map(turn => [turn.text, turn.status]), [['Save the blue car.', 'stopped'], ['Two', 'done'], ['Three', 'done']]);
});

test('5 · at most five messages wait in a chat; the sixth is refused with a sentence', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'] });
  const first = await awaiting(userId, 'chat-limit', m);
  const queued = [];
  for (let index = 1; index <= 5; index++) queued.push(await send(userId, 'chat-limit', 'req-limit-q' + index, 'Message ' + index, m.fetcher));
  await assert.rejects(() => send(userId, 'chat-limit', 'req-limit-q6', 'Message 6', m.fetcher),
    error => error.code === 'queue_full' && error.status === 409 && /Five messages already wait/.test(error.message));
  // A retried submit of one already queued is not a sixth.
  assert.equal((await send(userId, 'chat-limit', 'req-limit-q5', 'Message 5', m.fetcher)).run.runId, queued[4].run.runId);
  await runs.changeQueue(userId, { action: 'withdraw', runId: queued[0].run.runId });
  assert.equal((await send(userId, 'chat-limit', 'req-limit-q6', 'Message 6', m.fetcher)).run.status, 'waiting', 'room again after one is taken back');
  await runs.stopRun(userId, { runId: first.run.runId });
  await runs.changeQueue(userId, { action: 'clear', chat: 'chat-limit' });
});

test('5 · the token limit applies when a message starts: it was accepted, then ends as a failed turn, and the queue goes on', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'] });
  const first = await awaiting(userId, 'chat-budget', m);
  // The limit is reached while the messages wait: they are accepted anyway.
  await execute({ sql: 'UPDATE pocket_pip_background SET used_tokens = 50000 WHERE user_id = ?', args: [userId] });
  assert.equal((await send(userId, 'chat-budget', 'req-budget-2', 'Two', m.fetcher)).run.status, 'waiting');
  assert.equal((await send(userId, 'chat-budget', 'req-budget-3', 'Three', m.fetcher)).run.status, 'waiting');
  await runs.decideRun(userId, { runId: first.run.runId, requestId: first.requests[0].id, approved: false }, { fetcher: m.fetcher });
  const turns = (await chatOf(userId, 'chat-budget')).turns;
  assert.deepEqual(turns.map(turn => [turn.text, turn.status]), [['Save the blue car.', 'done'], ['Two', 'failed'], ['Three', 'failed']]);
  for (const turn of turns.slice(1)) assert.match(turn.error, /token limit for Pip on the server is used up/);
  assert.deepEqual(m.asked.filter(text => text !== 'Save the blue car.'), [], 'the model was not asked');
  assert.equal((await runs.queueView(userId, { chat: 'chat-budget' })).queue.length, 0);
});

test('5 · a queued message whose provider is no longer set up fails; one the model fails on fails; the next still runs', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'], fail: ['Broken'] });
  const first = await awaiting(userId, 'chat-fail', m);
  const elsewhere = { ...CONFIG, baseUrl: 'https://other.example/v1' };
  await runs.submitRun(userId, { requestId: 'req-fail-2', chat: { ...header('chat-fail'), config: elsewhere }, text: 'Other provider', device: 'phone-1' }, { fetcher: m.fetcher });
  await send(userId, 'chat-fail', 'req-fail-3', 'Broken', m.fetcher);
  await send(userId, 'chat-fail', 'req-fail-4', 'Fine', m.fetcher);
  await runs.decideRun(userId, { runId: first.run.runId, requestId: first.requests[0].id, approved: false }, { fetcher: m.fetcher });
  const turns = (await chatOf(userId, 'chat-fail')).turns;
  assert.deepEqual(turns.map(turn => [turn.text, turn.status]), [['Save the blue car.', 'done'], ['Other provider', 'failed'], ['Broken', 'failed'], ['Fine', 'done']]);
  assert.match(turns[1].error, /not set up for the selected provider/);
});

test('3 · in the one big chat only one message runs at a time, even while the reply in front writes a new segment', async () => {
  const userId = await account(), now = Date.now(), m = model();
  await writeObject(userId, 'chats', { uid: 'home-first', title: 'pip', titled: true, home: true, created: now - 5000, updated: now - 5000, draft: '', context: [], config: CONFIG, turns: [] });
  // A queued home message just started in a new segment: its run is active, its chat is not written yet.
  const turn = { uid: 'turn-new-segment', text: 'Started', context: [], created: now - 2000, updated: now - 2000, owner: 'phone-1', attempt: 'attempt-new', answer: '', reasoning: '', error: '', status: 'streaming', usage: {}, activity: [], sources: [], phase: 'requesting' };
  await execute({ sql: `INSERT INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
    VALUES (?, 'run-new-segment', 'home-unwritten', 'req-new-segment', 'turn-new-segment', 'phone-1', 'running', ?, NULL, ?, '[]', 'lease-held', ?, 0, ?, ?)`,
    args: [userId, JSON.stringify(turn), JSON.stringify({ ...CONFIG, grants: [], timezone: 'UTC', lane: 'home' }), now + 60000, now - 2000, now - 2000] });
  assert.equal((await send(userId, 'home-first', 'req-segment-2', 'Behind it', m.fetcher, { header: { title: 'pip', titled: true, home: true } })).run.status, 'waiting');
  const swept = await runs.sweepRuns({ fetcher: m.fetcher });
  assert.equal(swept.advanced, 0);
  assert.deepEqual((await runs.queueView(userId, { chat: 'home-first' })).queue.map(item => item.state), ['waiting']);
  assert.deepEqual(m.asked, []);
  // When it ends, the next one starts.
  await execute({ sql: "UPDATE pocket_pip_runs SET status = 'done', lease_id = '', lease_until = 0 WHERE user_id = ? AND run_id = 'run-new-segment'", args: [userId] });
  assert.equal((await runs.sweepRuns({ fetcher: m.fetcher })).advanced, 1);
  assert.deepEqual(m.asked, ['Behind it']);
});

test('1 · what a tab reads before it sends is the reply that runs, never a message still waiting', async () => {
  const userId = await account(), m = model({ write: ['Save the blue car.'] });
  const first = await awaiting(userId, 'chat-state', m);
  const queued = await send(userId, 'chat-state', 'req-state-2', 'Later.', m.fetcher);
  assert.equal((await runs.serverRunState(userId, 'chat-state')).run.run.runId, first.run.runId);
  await runs.changeQueue(userId, { action: 'withdraw', runId: queued.run.runId });
  await runs.stopRun(userId, { runId: first.run.runId });
  assert.equal((await runs.serverRunState(userId, 'chat-state')).run.run.runId, first.run.runId, 'a message taken back is not the chat’s last run');
});

test('2 · on the long-running server the queue runs through with no request waiting and no tab open', async () => {
  const userId = await account(), before = process.env.PIP_RUNS_MODE, m = model({ hold: true });
  process.env.PIP_RUNS_MODE = 'inprocess';
  try {
    // Every submit answers at once; the replies run in this process, detached from the requests that sent them.
    assert.equal((await send(userId, 'chat-detached', 'req-detached-1', 'One', m.fetcher)).run.status, 'running');
    await m.started;
    for (const [index, text] of ['Two', 'Three'].entries()) assert.equal((await send(userId, 'chat-detached', 'req-detached-' + (index + 2), text, m.fetcher)).run.status, 'waiting');
    m.release();
    // Each reply's end starts the next one in the background; wait until nothing is left running here.
    for (let round = 0; round < 20 && (await runs.queueView(userId, { chat: 'chat-detached' })).active; round++) await runs.settledRuns();
    assert.deepEqual((await chatOf(userId, 'chat-detached')).turns.map(turn => [turn.text, turn.status]), [['One', 'done'], ['Two', 'done'], ['Three', 'done']]);
    assert.deepEqual(m.asked, ['One', 'Two', 'Three']);
  } finally {
    await runs.settledRuns();
    if (before === undefined) delete process.env.PIP_RUNS_MODE; else process.env.PIP_RUNS_MODE = before;
  }
});

test('2 · with a worker, the next message is handed to the worker queue when the reply in front ends', async () => {
  const userId = await account(), before = process.env.PIP_RUNS_DETACHED, m = model();
  process.env.PIP_RUNS_DETACHED = '1';
  try {
    assert.equal((await send(userId, 'chat-worker', 'req-worker-1', 'One', m.fetcher)).run.status, 'queued');
    assert.equal((await send(userId, 'chat-worker', 'req-worker-2', 'Two', m.fetcher)).run.status, 'waiting');
    const steps = [];
    for (let step; (step = await runs.workerStep({ fetcher: m.fetcher })) && steps.length < 10;) if (step.userId === userId) steps.push(step.state);
    assert.deepEqual(steps, ['done', 'done']);
    assert.deepEqual((await chatOf(userId, 'chat-worker')).turns.map(turn => [turn.text, turn.status]), [['One', 'done'], ['Two', 'done']]);
  } finally { if (before === undefined) delete process.env.PIP_RUNS_DETACHED; else process.env.PIP_RUNS_DETACHED = before; }
});
