import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleMessage, event, response } from './pip-provider-fixtures.mjs';

// A real libSQL file database; no Turso account or provider key is used.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-restart-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments } = await import('../src/server/workspace.js');
const { saveBackground } = await import('../src/server/pip-background.js');
const { writeObject } = await import('../src/server/objects.js');
const runs = await import('../src/server/pip-runs.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const SETTINGS = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
const VAULT_CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
let users = 0;
async function account() {
  const id = 'user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, {
    'notes.json': { v: 1, notes: [{ uid: 'note-car', text: '# Car research\n\nThe blue car costs 21,000 euros.', pinned: false, created: now, updated: now, deleted: false }] },
    'agenda.json': { v: 1, events: [] }
  });
  await saveBackground(id, SETTINGS, 'fixture-key-123456');
  return id;
}
const header = (uid, title = 'Pip run') => ({ uid, title, created: Date.now(), config: VAULT_CONFIG });
const chatOf = async (userId, uid) => JSON.parse(String((await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0].payload));
const toolMessages = request => request.messages.filter(message => message.role === 'tool').map(message => String(message.content)).join('\n');

const failure = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function compatibleProblem(request) {
  const open = new Set();
  for (const message of request.messages) {
    if (message.role === 'tool') {
      if (!open.delete(message.tool_call_id)) return 'Invalid parameter: tool message ' + message.tool_call_id + ' does not follow its tool call.';
      if (typeof message.content !== 'string' || !message.content) return 'Invalid parameter: empty tool message.';
      continue;
    }
    if (open.size) return 'An assistant message with tool_calls must be followed by tool messages for each call: ' + [...open].join(', ');
    for (const call of message.role === 'assistant' ? message.tool_calls || [] : []) open.add(call.id);
  }
  return open.size ? 'Unanswered tool calls: ' + [...open].join(', ') : '';
}
/** A provider double: checks every request like the endpoint does, then streams the next prepared reply. */
const provider = (sent, ...replies) => async (url, options) => {
  const request = JSON.parse(options.body); sent.push(request);
  assert.equal(options.headers.authorization, 'Bearer fixture-key-123456');
  const problem = compatibleProblem(request);
  if (problem) return failure(400, { error: { message: problem, type: 'invalid_request_error' } });
  if (!replies.length) return failure(400, { error: { message: 'The fixture expected no further request.', type: 'invalid_request_error' } });
  return response(replies.shift());
};
/** Answers what it was given, then hangs like a request whose process is about to die. */
const hanging = (sent, ...replies) => async (url, options) => {
  const request = JSON.parse(options.body); sent.push(request);
  assert.equal(options.headers.authorization, 'Bearer fixture-key-123456');
  const problem = compatibleProblem(request);
  if (problem) return failure(400, { error: { message: problem, type: 'invalid_request_error' } });
  if (replies.length) return response(replies.shift());
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    if (options.signal?.aborted) abort(); else options.signal?.addEventListener('abort', abort, { once: true });
  });
};
const noProvider = async () => { throw new Error('The provider must not be called.'); };

async function until(check, message) {
  const limit = Date.now() + 5000;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > limit) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
const lookupDone = view => (view.run?.turn?.activity || []).some(row => row.name === 'search_notes' && row.state === 'done');
const lookup = () => compatibleMessage({ calls: [{ name: 'search_notes', input: { query: 'blue car' }, id: 'call_notes' }] });

/** A run that answered one lookup and is hanging on the request after it, still executing in this process. */
async function runningWithLookup(userId, chat, requestId) {
  const sent = [];
  const submitted = await runs.submitRun(userId, { requestId, chat: header(chat), text: 'What do my notes say about the blue car?' }, { fetcher: hanging(sent, lookup()) });
  assert.equal(submitted.run.status, 'running');
  await until(async () => lookupDone(await runs.runView(userId, { runId: submitted.run.runId })), 'the first lookup did not finish');
  return submitted;
}
async function suspended(userId, chat, requestId) {
  const submitted = await runningWithLookup(userId, chat, requestId);
  assert.equal(await runs.releaseRuns(), 1);
  return submitted;
}

const liveTurn = (uid, answer = 'Half an') => {
  const now = Date.now();
  return { uid, text: 'Research the blue car.', context: [], created: now, updated: now, owner: 'browser-1', attempt: 'attempt-' + uid,
    answer, reasoning: '', error: '', status: 'streaming', usage: {}, activity: [], sources: [], phase: 'writing' };
};
async function insertRun(userId, { runId, chat, status = 'running', created = Date.now(), leaseUntil = 0, turn = liveTurn('turn-' + runId) }) {
  await execute({ sql: `INSERT INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
    VALUES (?, ?, ?, ?, ?, 'browser-1', ?, ?, NULL, ?, '[]', ?, ?, 0, ?, ?)`,
    args: [userId, runId, chat, 'req-' + runId, turn.uid, status, JSON.stringify(turn), JSON.stringify(SETTINGS), 'lease-' + runId, leaseUntil, created, created] });
}

/** Sets inprocess mode for one test and leaves nothing running afterwards. */
async function inProcess(body) {
  const before = process.env.PIP_RUNS_MODE;
  process.env.PIP_RUNS_MODE = 'inprocess';
  try { await body(); } finally {
    await runs.releaseRuns();
    await runs.settledRuns();
    if (before === undefined) delete process.env.PIP_RUNS_MODE; else process.env.PIP_RUNS_MODE = before;
  }
}

test('a run lets go and is restarted once, keeping the lookup it finished', async () => {
  const userId = await account();
  await inProcess(async () => {
    const submitted = await runningWithLookup(userId, 'chat-restart', 'req-restart');
    assert.equal(await runs.releaseRuns(), 1);
    const row = (await execute({ sql: 'SELECT * FROM pocket_pip_runs WHERE user_id = ? AND run_id = ?', args: [userId, submitted.run.runId] })).rows[0];
    assert.equal(row.status, 'running'); assert.equal(Number(row.lease_until), 0);

    // The note changes after the lookup: looking it up again would find 25,000, reuse keeps the first result.
    await syncDocuments(userId, { 'notes.json': { v: 1, notes: [{ uid: 'note-car', text: '# Car research\n\nThe blue car costs 25,000 euros.', pinned: false, created: Date.now(), updated: Date.now() + 1000, deleted: false }] } });
    const sent = [];
    const second = provider(sent, lookup(), compatibleMessage({ text: 'Your note says the blue car costs 21,000 euros.' }));
    await runs.runView(userId, { runId: submitted.run.runId, fetcher: second });
    const done = await until(async () => {
      const view = await runs.runView(userId, { runId: submitted.run.runId });
      return view.run.status === 'done' ? view : null;
    }, 'the restarted run did not finish');

    assert.deepEqual(done.events.map(item => item.kind).filter(kind => kind === 'restarted'), ['restarted']);
    assert.equal(done.events.filter(item => item.kind === 'failed').length, 0);
    assert.equal(done.run.turn.answer, 'Your note says the blue car costs 21,000 euros.');
    const chat = await chatOf(userId, 'chat-restart');
    assert.equal(chat.turns.length, 1); assert.equal(chat.turns[0].answer, 'Your note says the blue car costs 21,000 euros.');
    // The second attempt asked for the same lookup, which was answered from the first attempt's activity.
    assert.equal(sent.length, 2);
    assert.match(toolMessages(sent[1]), /21,000/); assert.doesNotMatch(toolMessages(sent[1]), /25,000/);
  });
});

test('a restarted run that dies again fails instead of restarting a second time', async () => {
  const userId = await account();
  await inProcess(async () => {
    const submitted = await suspended(userId, 'chat-restart-twice', 'req-restart-twice');
    const sent = [];
    await runs.runView(userId, { runId: submitted.run.runId, fetcher: hanging(sent) });
    await until(() => sent.length === 1, 'the restarted attempt did not reach the provider');
    await execute({ sql: 'UPDATE pocket_pip_runs SET lease_until = 0 WHERE user_id = ? AND run_id = ?', args: [userId, submitted.run.runId] });
    assert.equal(await runs.releaseRuns(), 1);

    const view = await runs.runView(userId, { runId: submitted.run.runId });
    assert.equal(view.run.status, 'failed');
    assert.match(view.run.turn.error, /server stopped while writing this reply/);
    assert.equal(view.events.filter(item => item.kind === 'restarted').length, 1);
    assert.equal(view.events.filter(item => item.kind === 'interrupted').length, 1);
  });
});

test('an expired run older than ten minutes is failed, not restarted', async () => {
  const userId = await account();
  await inProcess(async () => {
    await insertRun(userId, { runId: 'run-too-old', chat: 'chat-too-old', created: Date.now() - 11 * 60000, leaseUntil: Date.now() - 1000 });
    const seen = await runs.runView(userId, { runId: 'run-too-old' });
    assert.equal(seen.run.status, 'failed');
    assert.match(seen.run.turn.error, /server stopped while writing this reply/);
    assert.equal(seen.events.filter(item => item.kind === 'restarted').length, 0);
  });
});

test('a stopping run is stopped, not restarted', async () => {
  const userId = await account();
  await inProcess(async () => {
    await insertRun(userId, { runId: 'run-stopping', chat: 'chat-stopping', status: 'stopping', leaseUntil: Date.now() - 1000 });
    const seen = await runs.runView(userId, { runId: 'run-stopping' });
    assert.equal(seen.run.status, 'stopped');
    assert.match(seen.run.turn.error, /Stopped\./);
    assert.equal(seen.events.filter(item => item.kind === 'restarted').length, 0);
    assert.equal(seen.events.filter(item => item.kind === 'stopped').length, 1);
  });
});

test('two views at once restart a run once', async () => {
  const userId = await account();
  await inProcess(async () => {
    const submitted = await suspended(userId, 'chat-restart-race', 'req-restart-race');
    const sent = [];
    const second = provider(sent, compatibleMessage({ text: 'The blue car costs 21,000 euros.' }));
    await Promise.all([
      runs.runView(userId, { runId: submitted.run.runId, fetcher: second }),
      runs.runView(userId, { runId: submitted.run.runId, fetcher: second }),
    ]);
    const done = await until(async () => {
      const view = await runs.runView(userId, { runId: submitted.run.runId });
      return view.run.status === 'done' ? view : null;
    }, 'the restarted run did not finish');
    assert.equal(done.events.filter(item => item.kind === 'restarted').length, 1);
    assert.equal(sent.length, 1, 'the new attempt asked the provider once');
    assert.equal(done.run.turn.answer, 'The blue car costs 21,000 euros.');
  });
});

test('a page view never restarts a dead run, while the sweep does', async () => {
  const userId = await account(), before = process.env.PIP_RUNS_MODE;
  delete process.env.PIP_RUNS_MODE;
  try {
    await insertRun(userId, { runId: 'run-view-dead', chat: 'chat-view-dead', leaseUntil: Date.now() - 1000 });
    const viewed = await runs.runView(userId, { runId: 'run-view-dead' });
    assert.equal(viewed.run.status, 'failed');
    assert.equal(viewed.events.filter(item => item.kind === 'restarted').length, 0);

    const now = Date.now(), turn = liveTurn('turn-sweep'), chat = { ...header('chat-sweep'), updated: now, draft: '', context: [], turns: [turn] };
    await writeObject(userId, 'chats', chat);
    await insertRun(userId, { runId: 'run-sweep', chat: 'chat-sweep', turn, leaseUntil: 0 });
    const sent = [];
    const swept = await runs.sweepRuns({ fetcher: provider(sent, compatibleMessage({ text: 'The sweep finished it.' })) });
    assert.equal(swept.restarted, 1);
    const done = await runs.runView(userId, { runId: 'run-sweep' });
    assert.equal(done.run.status, 'done', done.run.turn.error);
    assert.equal(done.run.turn.answer, 'The sweep finished it.');
    assert.equal(done.events.filter(item => item.kind === 'restarted').length, 1);
  } finally { if (before === undefined) delete process.env.PIP_RUNS_MODE; else process.env.PIP_RUNS_MODE = before; }
});
