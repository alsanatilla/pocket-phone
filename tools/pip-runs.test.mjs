import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anthropicMessage, compatibleMessage, event, response } from './pip-provider-fixtures.mjs';

// A real libSQL file database; no Turso account or provider key is used.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-run-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments, readDocuments } = await import('../src/server/workspace.js');
const { saveBackground, backgroundState } = await import('../src/server/pip-background.js');
const { seal } = await import('../src/server/secrets.js');
const { endpoint } = await import('../src/server/pip-keys.js');
const runs = await import('../src/server/pip-runs.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const SETTINGS = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
let users = 0;
async function account(settings = SETTINGS, key = 'fixture-key-123456') {
  const id = 'user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, {
    'notes.json': { v: 1, notes: [{ uid: 'note-car', text: '# Car research\n\nThe blue car costs 21,000 euros.', pinned: false, created: now, updated: now, deleted: false }] },
    'agenda.json': { v: 1, events: [{ uid: 'appt-1', title: 'Synced dentist', when: now + 3600000, minutes: 45, remindAt: 0, task_uid: '', created: now, updated: now }] }
  });
  await saveBackground(id, settings, key);
  return id;
}
const CONFIG = { provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', maxTokens: 4096, thinking: false, webSearch: false };
/** A chat whose own settings point at the fixture's compatible endpoint, so a vaulted key can run it. */
const VAULT_CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
const header = (uid, title = 'Pip run', config = CONFIG) => ({ uid, title, created: Date.now(), config });
const chatOf = async (userId, uid) => JSON.parse(String((await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0].payload));
const notesOf = async userId => (await readDocuments(userId))['notes.json'].value.notes.filter(note => note.uid.startsWith('pip-'));
const toolMessages = request => request.messages.filter(message => message.role === 'tool').map(message => String(message.content)).join('\n');

test('a run keeps the turn id and attempt the client sent, and marks itself as a server reply', async () => {
  const userId = await account(), sent = [];
  const submitted = await runs.submitRun(userId, { requestId: 'req-ids', chat: header('chat-ids', 'Ids'), device: 'browser-1',
    attempt: 'attempt-fixed', turnUid: 'turn-fixed', text: 'Sag kurz Hallo.' }, { fetcher: provider(sent, compatibleMessage({ text: 'Hallo.' })) });
  assert.equal(submitted.run.status, 'done');
  assert.equal(submitted.run.turn.uid, 'turn-fixed');
  assert.equal(submitted.run.turn.attempt, 'attempt-fixed');
  assert.equal(submitted.run.turn.usage.runtime, 'pocket-server');
  // The synced conversation holds that one turn, so the tab does not end up with a second copy of the question.
  const stored = await chatOf(userId, 'chat-ids');
  assert.equal(stored.turns.length, 1);
  assert.equal(stored.turns[0].uid, 'turn-fixed');
  assert.equal(stored.turns[0].usage.runtime, 'pocket-server');
});
const failure = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// What a chat-completions endpoint refuses: a tool call without its result before the next message, a result for
// a call it never made, or an empty tool message. The double answers those with 400, as the provider would.
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
const noProvider = async () => { throw new Error('The provider must not be called.'); };
const write = (input, id = 'call_write') => compatibleMessage({ calls: [{ name: 'create_record', input, id }] });
const NOTE = { kind: 'note', title: 'Blue car', text: '21,000 euros' };
async function waiting(userId, chat, requestId = 'req-' + chat) {
  const sent = [], submitted = await runs.submitRun(userId, { requestId, chat: header(chat), text: 'Save the blue car price as a note.', device: 'phone-1' }, { fetcher: provider(sent, write(NOTE)) });
  assert.equal(submitted.run.status, 'awaiting', 'waiting failed: ' + submitted.run.turn.error);
  return { sent, submitted, request: submitted.requests[0] };
}

test('a run answers in the server conversation both devices read', async () => {
  const userId = await account(), sent = [];
  const view = await runs.submitRun(userId, { requestId: 'req-answer', chat: header('chat-answer'), text: 'What do my notes say about the blue car?', device: 'browser-1' },
    { fetcher: provider(sent, compatibleMessage({ calls: [{ name: 'search_notes', input: { query: 'blue car' }, id: 'call_notes' }] }), compatibleMessage({ text: 'Your note says the blue car costs 21,000 euros.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error); assert.equal(view.run.chat, 'chat-answer'); assert.equal(view.run.turnUid, view.run.turn.uid);
  assert.equal(view.run.turn.answer, 'Your note says the blue car costs 21,000 euros.');
  assert.equal(view.run.turn.owner, 'browser-1');
  assert.match(view.run.turn.activity.find(item => item.name === 'search_notes').result, /blue car/);
  const chat = await chatOf(userId, 'chat-answer');
  assert.equal(chat.turns.length, 1); assert.equal(chat.turns[0].uid, view.run.turn.uid); assert.equal(chat.turns[0].status, 'done');
  assert.deepEqual(view.events.map(item => item.kind), ['started', 'done']);
  const watched = await runs.runView(userId, { runId: view.run.runId });
  assert.equal(watched.run.turn.answer, view.run.turn.answer);
  // The account's grants reach the tools; calendar comes from the synced copy.
  const offered = sent[0].tools.map(tool => tool.function.name);
  assert.ok(offered.includes('search_notes')); assert.ok(offered.includes('search_calendar')); assert.ok(offered.includes('create_record'));
});

test('an approved change continues the reply and is saved once, with the user\'s edits', async () => {
  const userId = await account(), { sent, submitted, request } = await waiting(userId, 'chat-write');
  assert.equal(request.kind, 'write'); assert.equal(request.tool, 'create_record'); assert.equal(request.state, 'pending'); assert.equal(request.payload.action.title, 'Blue car');
  assert.equal((await notesOf(userId)).length, 0, 'nothing is written before the decision');
  assert.equal((await chatOf(userId, 'chat-write')).turns[0].phase, 'waiting for your approval', 'the synced chat shows the wait');
  const edited = { ...NOTE, title: 'Blue car, checked' };
  const decided = await runs.decideRun(userId, { runId: submitted.run.runId, requestId: request.id, approved: true, input: edited, device: 'browser-1' }, { fetcher: provider(sent, compatibleMessage({ text: 'Saved your note.' })) });
  assert.equal(decided.run.status, 'done', 'continue failed: ' + decided.run.turn.error); assert.equal(decided.run.turn.answer, 'Saved your note.');
  const notes = await notesOf(userId);
  assert.equal(notes.length, 1); assert.match(notes[0].text, /^# Blue car, checked/, 'the edit is what was saved');
  assert.equal(decided.run.turn.activity.find(item => item.name === 'create_record').applied_href, '/notes/' + notes[0].uid);
  assert.equal(decided.requests[0].state, 'approved'); assert.equal(decided.requests[0].by, 'browser-1');
  // The provider continued the same conversation: the saved result answers the call it made.
  assert.equal(sent.length, 2); assert.match(toolMessages(sent[1]), /"status":"saved"/);
  // The other device agreeing afterwards is not a second decision, a second request or a second note.
  const again = await runs.decideRun(userId, { runId: submitted.run.runId, requestId: request.id, approved: true, device: 'phone-1' }, { fetcher: noProvider });
  assert.equal(again.run.status, 'done'); assert.equal(sent.length, 2); assert.equal((await notesOf(userId)).length, 1);
  assert.equal((await chatOf(userId, 'chat-write')).turns[0].status, 'done');
});

test('two devices deciding at once settle it once and continue once', async () => {
  const userId = await account(), { sent, submitted, request } = await waiting(userId, 'chat-race');
  const [left, right] = await Promise.all([
    runs.decideRun(userId, { runId: submitted.run.runId, requestId: request.id, approved: true, device: 'browser-1' }, { fetcher: provider(sent, compatibleMessage({ text: 'Saved.' })) }),
    runs.decideRun(userId, { runId: submitted.run.runId, requestId: request.id, approved: false, device: 'phone-1' }, { fetcher: provider(sent, compatibleMessage({ text: 'Not saved.' })) })]);
  const final = await runs.runView(userId, { runId: submitted.run.runId });
  assert.equal(final.run.status, 'done', final.run.turn.error); assert.equal(sent.length, 2, 'one continuation');
  const kept = final.requests[0].state;
  assert.equal((await notesOf(userId)).length, kept === 'approved' ? 1 : 0, 'what was saved matches the decision that won');
  assert.ok([left, right].every(view => view.requests[0].state === kept));
});

test('a declined change never runs and the model is told', async () => {
  const userId = await account(), { sent, submitted, request } = await waiting(userId, 'chat-decline');
  const decided = await runs.decideRun(userId, { runId: submitted.run.runId, requestId: request.id, approved: false, device: 'browser-1' }, { fetcher: provider(sent, compatibleMessage({ text: 'Understood, nothing was saved.' })) });
  assert.equal(decided.run.status, 'done', 'decline failed: ' + decided.run.turn.error);
  assert.equal((await notesOf(userId)).length, 0);
  const row = decided.run.turn.activity.find(item => item.name === 'create_record');
  assert.equal(row.state, 'done'); assert.match(row.result, /declined/);
  assert.match(toolMessages(sent[1]), /declined this change/);
});

test('a device tool is answered by the device that owns its source', async () => {
  const userId = await account(), sent = [];
  const submitted = await runs.submitRun(userId, { requestId: 'req-device', chat: header('chat-device'), text: 'What is on my calendar?', device: 'phone-1', deviceTools: ['search_calendar', 'create_record'] },
    { fetcher: provider(sent, compatibleMessage({ calls: [{ name: 'search_calendar', input: { query: 'dentist' }, id: 'call_day' }] })) });
  assert.equal(submitted.run.status, 'awaiting', submitted.run.turn.error); assert.equal(submitted.run.turn.phase, 'waiting for your device');
  assert.equal(submitted.requests.length, 1); assert.equal(submitted.requests[0].kind, 'device'); assert.deepEqual(submitted.requests[0].payload.input, { query: 'dentist' });
  const result = { source: 'phone:calendar', days: 7, matched: 1, appointments: [{ id: 'appt-9', title: 'Dentist on the phone', when: '2026-10-20T10:00:00.000Z', minutes: 45, task_uid: '', href: '/calendar/appt-9' }] };
  const decided = await runs.decideRun(userId, { runId: submitted.run.runId, requestId: submitted.requests[0].id, result, device: 'phone-1' }, { fetcher: provider(sent, compatibleMessage({ text: 'Your dentist appointment is coming up.' })) });
  assert.equal(decided.run.status, 'done', 'device failed: ' + decided.run.turn.error);
  // The model received the phone's answer, not the server's synced copy.
  assert.match(toolMessages(sent[1]), /appt-9/); assert.doesNotMatch(toolMessages(sent[1]), /appt-1/);
  const row = decided.run.turn.activity.find(item => item.name === 'search_calendar');
  assert.equal(row.state, 'done'); assert.equal(row.sources[0].title, 'Dentist on the phone');
});

test('a device that cannot answer lets the model continue without it', async () => {
  const userId = await account(), sent = [];
  const submitted = await runs.submitRun(userId, { requestId: 'req-device-off', chat: header('chat-device-off'), text: 'What is on my calendar?', device: 'phone-1', deviceTools: ['search_calendar'] },
    { fetcher: provider(sent, compatibleMessage({ calls: [{ name: 'search_calendar', input: { query: '' }, id: 'call_day' }] })) });
  await assert.rejects(() => runs.decideRun(userId, { runId: submitted.run.runId, requestId: submitted.requests[0].id, result: ['not', 'an', 'object'] }, { fetcher: noProvider }), /result as an object/);
  const decided = await runs.decideRun(userId, { runId: submitted.run.runId, requestId: submitted.requests[0].id, approved: false, device: 'phone-1' }, { fetcher: provider(sent, compatibleMessage({ text: 'I could not read your calendar.' })) });
  assert.equal(decided.run.status, 'done', decided.run.turn.error); assert.match(toolMessages(sent[1]), /device_unavailable/);
});

test('calendar reads come from the account copy when no device owns the source', async () => {
  const userId = await account(), sent = [];
  const view = await runs.submitRun(userId, { requestId: 'req-agenda', chat: header('chat-agenda'), text: 'What is on my calendar?', device: 'browser-1' },
    { fetcher: provider(sent, compatibleMessage({ calls: [{ name: 'search_calendar', input: { query: 'dentist' }, id: 'call_day' }] }), compatibleMessage({ text: 'Dentist at ten.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.match(toolMessages(sent[1]), /appt-1/);
});

test('a run reads only what the submitting chat allows', async () => {
  const userId = await account(), sent = [];
  const view = await runs.submitRun(userId, { requestId: 'req-grants', chat: header('chat-grants'), text: 'Anything due?', device: 'browser-1', grants: ['tasks', 'thoughts'] },
    { fetcher: provider(sent, compatibleMessage({ text: 'Nothing is due.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  const offered = sent[0].tools.map(tool => tool.function.name);
  assert.ok(offered.includes('search_tasks')); assert.ok(!offered.includes('search_notes'), 'notes were not allowed in this chat');
  assert.ok(!offered.includes('search_thoughts'), 'thoughts are not granted to the server'); assert.ok(!offered.includes('search_calendar'));
});

test('a retried submit reuses the run instead of asking the model twice', async () => {
  const userId = await account(), sent = [];
  const body = { requestId: 'req-once', chat: header('chat-once'), text: 'Anything to do?', device: 'browser-1' };
  const first = await runs.submitRun(userId, body, { fetcher: provider(sent, compatibleMessage({ text: 'Nothing needs doing.' })) });
  const second = await runs.submitRun(userId, body, { fetcher: noProvider });
  assert.equal(second.run.runId, first.run.runId); assert.equal(sent.length, 1);
  assert.equal((await chatOf(userId, 'chat-once')).turns.length, 1);
});

test('a refused submit leaves no run behind', async () => {
  const userId = await account();
  await assert.rejects(() => runs.submitRun(userId, { requestId: 'req-bad', chat: header('chat-bad'), text: 'Use this', context: [{ text: 'no title' }] }, { fetcher: noProvider }), /attached sources/);
  assert.equal((await runs.serverRunState(userId, 'chat-bad')).run, null);
  const later = await runs.submitRun(userId, { requestId: 'req-bad', chat: header('chat-bad'), text: 'Use this', context: [{ title: 'Note', text: 'with a title' }] }, { fetcher: provider([], compatibleMessage({ text: 'Done.' })) });
  assert.equal(later.run.status, 'done', 'the same request id works once it is valid');
});

test('one unfinished reply per conversation; another device attaches instead', async () => {
  const userId = await account(), { submitted } = await waiting(userId, 'chat-one');
  await assert.rejects(() => runs.submitRun(userId, { requestId: 'req-second', chat: header('chat-one'), text: 'Something else', device: 'browser-1' }, { fetcher: noProvider }), /current reply/);
  assert.equal((await runs.runView(userId, { chat: 'chat-one' })).run.runId, submitted.run.runId);
  await runs.stopRun(userId, { runId: submitted.run.runId, device: 'browser-1' });
  const next = await runs.submitRun(userId, { requestId: 'req-second', chat: header('chat-one'), text: 'Something else', device: 'browser-1' }, { fetcher: provider([], compatibleMessage({ text: 'Sure.' })) });
  assert.equal(next.run.status, 'done', next.run.turn.error);
});

test('a stop while waiting ends the run on every device, and the wait cannot be answered later', async () => {
  const userId = await account(), { submitted, request } = await waiting(userId, 'chat-stop-wait');
  const stopped = await runs.stopRun(userId, { runId: submitted.run.runId, device: 'browser-1' });
  assert.equal(stopped.run.status, 'stopped'); assert.equal(stopped.run.turn.status, 'stopped'); assert.equal(stopped.requests[0].state, 'stopped');
  const row = stopped.run.turn.activity.find(item => item.name === 'create_record');
  assert.equal(row.state, 'stopped');
  assert.equal((await chatOf(userId, 'chat-stop-wait')).turns[0].status, 'stopped', 'the synced chat shows the stop');
  await assert.rejects(() => runs.decideRun(userId, { runId: submitted.run.runId, requestId: request.id, approved: true }, { fetcher: noProvider }), /no longer waiting/);
  assert.equal((await notesOf(userId)).length, 0);
});

test('a stop while the server is writing ends that request\'s reply, and nothing overwrites it', async () => {
  const userId = await account(), sent = [];
  let begun; const started = new Promise(resolve => { begun = resolve; });
  const stalled = async (url, options) => {
    sent.push(JSON.parse(options.body)); begun();
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(event({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1791500000, model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Looking into' }, finish_reason: null }] })));
      options.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true });
    } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  const submitting = runs.submitRun(userId, { requestId: 'req-stop-live', chat: header('chat-stop-live'), text: 'Research the blue car.', device: 'browser-1' }, { fetcher: stalled });
  await started;
  const live = await runs.runView(userId, { chat: 'chat-stop-live' });
  assert.equal(live.run.status, 'running');
  const stopping = await runs.stopRun(userId, { runId: live.run.runId, device: 'phone-1' });
  assert.equal(stopping.run.status, 'stopping', 'the executing request ends it');
  const finished = await submitting;
  assert.equal(finished.run.status, 'stopped'); assert.equal(finished.run.turn.status, 'stopped'); assert.equal(sent.length, 1);
  assert.equal((await chatOf(userId, 'chat-stop-live')).turns[0].status, 'stopped');
  assert.deepEqual(finished.events.map(item => item.kind), ['started', 'stopping', 'stopped']);
});

test('a stop that lands just before the run pauses still stops it', async () => {
  const userId = await account();
  const stopFirst = async (url, options) => {
    // Another device stops the run while the provider is still answering with a change to approve.
    await execute({ sql: "UPDATE pocket_pip_runs SET status = 'stopping' WHERE user_id = ? AND chat_uid = 'chat-stop-race'", args: [userId] });
    return provider([], write(NOTE))(url, options);
  };
  const view = await runs.submitRun(userId, { requestId: 'req-stop-race', chat: header('chat-stop-race'), text: 'Save it.', device: 'browser-1' }, { fetcher: stopFirst });
  assert.equal(view.run.status, 'stopped'); assert.equal(view.requests.length, 0, 'nothing waits on a stopped run');
  assert.equal((await chatOf(userId, 'chat-stop-race')).turns[0].status, 'stopped');
});

test('a run whose request died is ended, and the conversation is free again', async () => {
  const userId = await account(), now = Date.now();
  const turn = { uid: 'turn-dead', text: 'Research it.', context: [], created: now, updated: now, owner: 'browser-1', attempt: 'attempt-dead', answer: 'Half an', reasoning: '', error: '', status: 'streaming', usage: {}, activity: [], sources: [], phase: 'writing' };
  const { writeObject } = await import('../src/server/objects.js');
  await writeObject(userId, 'chats', { ...header('chat-dead'), updated: now, draft: '', context: [], turns: [turn] });
  await execute({ sql: `INSERT INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
    VALUES (?, 'run-dead', 'chat-dead', 'req-dead', 'turn-dead', 'browser-1', 'running', ?, NULL, ?, '[]', 'lease-gone', ?, 0, ?, ?)`, args: [userId, JSON.stringify(turn), JSON.stringify(SETTINGS), now - 1000, now, now] });
  const seen = await runs.runView(userId, { runId: 'run-dead' });
  assert.equal(seen.run.status, 'failed'); assert.match(seen.run.turn.error, /server stopped/); assert.equal(seen.run.turn.answer, 'Half an');
  assert.equal((await chatOf(userId, 'chat-dead')).turns[0].status, 'failed');
  const next = await runs.submitRun(userId, { requestId: 'req-after-dead', chat: header('chat-dead'), text: 'Try again.', device: 'browser-1' }, { fetcher: provider([], compatibleMessage({ text: 'Here it is.' })) });
  assert.equal(next.run.status, 'done', next.run.turn.error);
});

test('settled decisions continue even when the request that settled them ended', async () => {
  const userId = await account(), { sent, submitted, request } = await waiting(userId, 'chat-orphan');
  // The decision was stored, but the request that would have continued the run never got to it.
  await execute({ sql: "UPDATE pocket_pip_run_requests SET state = 'approved', decided_by = 'phone-1' WHERE user_id = ? AND request_id = ?", args: [userId, request.id] });
  const [left, right] = await Promise.all([runs.continueRun(userId, submitted.run.runId, { fetcher: provider(sent, compatibleMessage({ text: 'Saved.' })) }),
    runs.continueRun(userId, submitted.run.runId, { fetcher: provider(sent, compatibleMessage({ text: 'Saved.' })) })]);
  assert.equal([left, right].filter(Boolean).length, 1, 'one request continues the run');
  const done = await runs.runView(userId, { runId: submitted.run.runId });
  assert.equal(done.run.status, 'done', done.run.turn.error); assert.equal(sent.length, 2); assert.equal((await notesOf(userId)).length, 1);
});

test('a wait nobody answers expires into an answer with what the model already has', async () => {
  const userId = await account(), { sent, submitted } = await waiting(userId, 'chat-expire');
  const swept = await runs.sweepRuns({ fetcher: provider(sent, compatibleMessage({ text: 'No change was saved.' })), now: Date.now() + 13 * 3600000 });
  assert.equal(swept.expired, 1); assert.equal(swept.continued, 1);
  const later = await runs.runView(userId, { runId: submitted.run.runId });
  assert.equal(later.run.status, 'done', later.run.turn.error); assert.equal(later.run.turn.answer, 'No change was saved.');
  assert.equal(later.requests[0].state, 'declined'); assert.equal(later.requests[0].by, 'expiry');
  assert.equal((await notesOf(userId)).length, 0);
  assert.equal((await runs.sweepRuns({ fetcher: noProvider })).continued, 0, 'nothing is left to continue');
});

test('shared runs count against the daily token limit across pauses, and stop at it', async () => {
  const userId = await account({ ...SETTINGS, dailyTokens: 1000 }), { sent, submitted, request } = await waiting(userId, 'chat-budget');
  await runs.decideRun(userId, { runId: submitted.run.runId, requestId: request.id, approved: true }, { fetcher: provider(sent, compatibleMessage({ text: 'Saved.' })) });
  const done = await runs.runView(userId, { runId: submitted.run.runId });
  assert.equal(done.run.turn.usage.input_tokens, 20); assert.equal(done.run.turn.usage.output_tokens, 16, 'usage adds up across both requests');
  assert.equal((await backgroundState(userId)).usedToday, 36);
  await execute({ sql: 'UPDATE pocket_pip_background SET used_tokens = 1000 WHERE user_id = ?', args: [userId] });
  await assert.rejects(() => runs.submitRun(userId, { requestId: 'req-over', chat: header('chat-budget-2'), text: 'Hello', device: 'browser-1' }, { fetcher: noProvider }), /token limit/);
});

test('an Anthropic run pauses and continues with its tool results where the API requires them', async () => {
  const userId = await account({ ...SETTINGS, provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1' }, 'sk-ant-fixture-key'), sent = [];
  const anthropic = (...replies) => async (url, options) => {
    const request = JSON.parse(options.body); sent.push(request);
    assert.equal(options.headers['x-api-key'], 'sk-ant-fixture-key');
    // The Messages API refuses a tool_use whose tool_result is not in the very next user message.
    for (const [index, message] of request.messages.entries()) {
      const uses = message.role === 'assistant' && Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_use').map(block => block.id) : [];
      const next = request.messages[index + 1], results = new Set(next?.role === 'user' && Array.isArray(next.content) ? next.content.filter(block => block.type === 'tool_result').map(block => block.tool_use_id) : []);
      const missing = uses.filter(id => !results.has(id));
      if (missing.length) return failure(400, { type: 'error', error: { type: 'invalid_request_error', message: 'tool_use ids were found without tool_result blocks immediately after: ' + missing.join(', ') } });
    }
    return response(replies.shift());
  };
  const submitted = await runs.submitRun(userId, { requestId: 'req-anthropic', chat: header('chat-anthropic'), text: 'Save the blue car price.', device: 'phone-1' },
    { fetcher: anthropic(anthropicMessage({ text: 'I will save it.', calls: [{ name: 'create_record', input: NOTE, id: 'toolu_write' }] })) });
  assert.equal(submitted.run.status, 'awaiting', submitted.run.turn.error);
  const decided = await runs.decideRun(userId, { runId: submitted.run.runId, requestId: submitted.requests[0].id, approved: true, device: 'browser-1' }, { fetcher: anthropic(anthropicMessage({ text: 'Saved your note.' })) });
  assert.equal(decided.run.status, 'done', decided.run.turn.error); assert.equal(decided.run.turn.answer, 'Saved your note.');
  const answered = sent[1].messages.flatMap(message => Array.isArray(message.content) ? message.content : []).find(block => block.type === 'tool_result');
  assert.equal(answered.tool_use_id, 'toolu_write'); assert.match(JSON.stringify(answered.content), /saved/);
  assert.equal((await notesOf(userId)).length, 1);
});

test('the server refuses a run until the account opts in', async () => {
  const id = 'user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await assert.rejects(() => runs.submitRun(id, { requestId: 'req-none', chat: header('chat-none'), text: 'Hello', device: 'browser-1' }, { fetcher: noProvider }), /not set up/);
  const state = await runs.serverRunState(id, 'chat-none');
  assert.equal(state.available, false); assert.equal(state.run, null);
});

/** A signed-in account whose only key for that chat's endpoint lives in the account vault — no “on its own” key. */
async function vaultAccount(config = VAULT_CONFIG, key = 'fixture-key-123456') {
  const id = 'user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes: [{ uid: 'note-car', text: '# Car research\n\nThe blue car costs 21,000 euros.', pinned: false, created: now, updated: now, deleted: false }] } });
  const target = endpoint(config.provider, config.baseUrl);
  await execute({ sql: 'INSERT INTO pocket_pip_keys (user_id, endpoint, provider, sealed, hint, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    args: [id, target, config.provider, seal(id, { provider: config.provider, endpoint: target, key }), key.slice(-4), now] });
  return id;
}

test('a chat runs on the server with the key this account stored in its vault', async () => {
  const userId = await vaultAccount(), sent = [];
  const state = await runs.serverRunState(userId, 'chat-vault', VAULT_CONFIG);
  assert.equal(state.available, true, 'a vaulted key for the chat’s endpoint makes the server available');
  const submitted = await runs.submitRun(userId, { requestId: 'req-vault', chat: header('chat-vault', 'Vault chat', VAULT_CONFIG), device: 'phone-1',
    text: 'What do my notes say about the blue car?', grants: ['notes'], timezone: 'Europe/Berlin' },
    { fetcher: provider(sent, compatibleMessage({ calls: [{ name: 'search_notes', input: { query: 'blue car' }, id: 'call_notes' }] }), compatibleMessage({ text: 'Your note says the blue car costs 21,000 euros.' })) });
  assert.equal(submitted.run.status, 'done', 'vault run failed: ' + submitted.run.turn.error);
  assert.equal(submitted.run.turn.answer, 'Your note says the blue car costs 21,000 euros.');
  assert.equal(submitted.run.turn.usage.runtime, 'pocket-server', 'a vault run is still a server reply');
  // The model the chat uses is the one the reply ran on, and the request went out with that chat's key.
  assert.equal(submitted.run.turn.model, VAULT_CONFIG.model);
  assert.equal(sent[0].model, VAULT_CONFIG.model);
  // Access is what the client asked for, nothing more: notes, and no task tool.
  const offered = sent[0].tools.map(tool => tool.function.name);
  assert.ok(offered.includes('search_notes')); assert.ok(!offered.includes('search_tasks'), 'grants are the chat’s own: ' + offered.join(','));
  // Today's date in the chat's timezone reached the instructions.
  assert.match(sent[0].messages[0].content, /Europe\/Berlin/);
});

test('a vaulted key for another endpoint does not make the server available', async () => {
  const userId = await vaultAccount(VAULT_CONFIG), elsewhere = { ...VAULT_CONFIG, baseUrl: 'https://other.example/v1' };
  const state = await runs.serverRunState(userId, 'chat-elsewhere', elsewhere);
  assert.equal(state.available, false);
  await assert.rejects(() => runs.submitRun(userId, { requestId: 'req-elsewhere', chat: header('chat-elsewhere', 'Elsewhere', elsewhere), text: 'Hello', device: 'browser-1' },
    { fetcher: noProvider }), /not set up/);
});

test('a follower reads a finished run once, as the last frame', async () => {
  const userId = await account(), sent = [];
  const submitted = await runs.submitRun(userId, { requestId: 'req-follow', chat: header('chat-follow'), text: 'Sag kurz Hallo.', device: 'browser-1' },
    { fetcher: provider(sent, compatibleMessage({ text: 'Hallo.' })) });
  const frames = [];
  for await (const frame of runs.runFrames(userId, { runId: submitted.run.runId })) frames.push(frame);
  assert.equal(frames.length, 1, 'a settled run is sent once and ends the connection');
  assert.equal(frames[0].run.status, 'done');
  assert.equal(frames[0].run.turn.answer, 'Hallo.');
  assert.equal(frames[0].cursor, submitted.cursor);
});

test('a follower of a waiting run keeps the connection and settles on its own time limit', async () => {
  const userId = await account(), { submitted } = await waiting(userId, 'chat-hold');
  const started = Date.now(), frames = [];
  for await (const frame of runs.runFrames(userId, { runId: submitted.run.runId, ttl: 400 })) frames.push(frame);
  assert.equal(frames.length, 1, 'an unchanged waiting run is not sent twice');
  assert.equal(frames[0].run.status, 'awaiting');
  assert.ok(Date.now() - started >= 250, 'the connection is held open, not closed at once');
  // A new connection sees the same waiting run, so a follower that reconnects misses nothing.
  const again = [];
  for await (const frame of runs.runFrames(userId, { runId: submitted.run.runId, ttl: 260 })) again.push(frame);
  assert.equal(again[0].run.status, 'awaiting');
  assert.equal(again[0].requests[0].state, 'pending');
});

test('a follower that asks by request id sees the run\'s lookups while the submitting request still runs it', async () => {
  const userId = await account(), sent = [];
  let release; const held = new Promise(resolve => { release = resolve; });
  // The first round looks something up; the second holds its answer, so the submit is still running while the follower reads.
  const replies = [compatibleMessage({ calls: [{ name: 'search_notes', input: { query: 'blue car' }, id: 'call_notes' }] })];
  const fetcher = async (url, options) => {
    sent.push(JSON.parse(options.body));
    if (replies.length) return response(replies.shift());
    await held;
    return response(compatibleMessage({ text: 'Your note says the blue car costs 21,000 euros.' }));
  };
  const submitting = runs.submitRun(userId, { requestId: 'req-live-tools', chat: header('chat-live-tools'), text: 'What do my notes say about the blue car?', device: 'browser-1' }, { fetcher });
  // The follower can start before the submit has created the run: it waits for it instead of reporting it missing.
  let seen = null;
  for await (const frame of runs.runFrames(userId, { request: 'req-live-tools', ttl: 5000 })) {
    if (frame.run?.turn?.activity?.some(row => row.name === 'search_notes' && row.state === 'done')) { seen = frame; break; }
  }
  assert.ok(seen, 'the lookup reached the follower before the reply finished');
  assert.equal(seen.run.status, 'running');
  release();
  const finished = await submitting;
  assert.equal(finished.run.status, 'done', finished.run.turn.error);
  assert.equal(finished.run.turn.answer, 'Your note says the blue car costs 21,000 euros.');
});
