import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleMessage, response } from './pip-provider-fixtures.mjs';

// Pip's memory of the person: the list itself, what a change publishes, and the two tools a server reply and a job
// run. A real libSQL file database; no Turso account or provider key is used.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-memory-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments } = await import('../src/server/workspace.js');
const background = await import('../src/server/pip-background.js');
const runs = await import('../src/server/pip-runs.js');
const memory = await import('../src/server/pip-memory-store.js');
const events = await import('../src/server/pocket-events.js');
const keys = await import('../src/server/pip-keys.js');
const { toolNames, summary } = await import('../src/client/pip-tools.js');
const { JEV_ENDPOINT } = await import('../src/shared/girder-jev.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const SETTINGS = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
const VAULT_CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
const OPENROUTER = 'https://openrouter.ai/api/v1', OPENROUTER_KEY = 'sk-or-fixture-memory-0123456789';
let users = 0;
async function account({ openrouter = false } = {}) {
  const id = 'memory-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes: [{ uid: 'note-car', text: '# Car research\n\nThe blue car costs 21,000 euros.', pinned: false, created: now, updated: now, deleted: false }] } });
  await background.saveBackground(id, SETTINGS, 'fixture-key-123456');
  if (openrouter) await keys.saveKey(id, { provider: 'compatible', baseUrl: OPENROUTER, key: OPENROUTER_KEY });
  return id;
}
const header = (uid, title = 'Pip run') => ({ uid, title, created: Date.now(), config: VAULT_CONFIG });
const refusal = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** What a chat-completions endpoint refuses: a tool call without its result before the next message, and so on. */
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
  if (problem) return refusal(400, { error: { message: problem, type: 'invalid_request_error' } });
  if (!replies.length) return refusal(400, { error: { message: 'The fixture expected no further request.', type: 'invalid_request_error' } });
  return response(replies.shift());
};

test('a fact is tidied, cut at 300 characters, refused when empty, and remembered once', async () => {
  const userId = await account();
  const saved = await memory.remember(userId, '  Trains  for a\n half marathon. ');
  assert.equal(saved.text, 'Trains for a half marathon.');
  assert.equal(saved.replaced, false); assert.equal(saved.added, true);
  assert.deepEqual((await memory.listMemory(userId)).map(entry => entry.text), ['Trains for a half marathon.']);

  const again = await memory.remember(userId, 'TRAINS FOR A HALF MARATHON.');
  assert.equal(again.id, saved.id, 'the same text in another case is the same fact');
  assert.equal(again.added, false); assert.equal(again.replaced, false);
  assert.equal((await memory.listMemory(userId)).length, 1, 'the same request sent twice adds one entry');

  await assert.rejects(() => memory.remember(userId, '  \n '), error => error.code === 'memory_empty' && error.status === 400);
  const long = await memory.remember(userId, 'Long. '.repeat(60));
  assert.equal(long.text.length, memory.MEMORY_TEXT, 'a fact is cut at 300 characters');
});

test('replaces corrects an entry in place, and a full list refuses a new one but still takes a correction', async () => {
  const userId = await account();
  await memory.remember(userId, 'Likes long answers.');
  const [before] = await memory.listMemory(userId);
  const fixed = await memory.remember(userId, 'Likes short answers without preamble.', { replaces: before.id });
  const [after] = await memory.listMemory(userId);
  assert.equal(fixed.id, before.id); assert.equal(fixed.replaced, true); assert.equal(fixed.added, false);
  assert.equal(after.id, before.id); assert.equal(after.created, before.created, 'the entry keeps when it was learned');
  assert.equal(after.text, 'Likes short answers without preamble.');
  assert.ok(after.updated >= before.updated);
  await assert.rejects(() => memory.remember(userId, 'Another fact.', { replaces: 'm000000' }), error => error.code === 'memory_missing' && error.status === 404);

  const full = await account();
  for (let index = 0; index < memory.MEMORY_MAX; index++) await memory.remember(full, 'Fact number ' + index + '.');
  await assert.rejects(() => memory.remember(full, 'One more fact.'), error => error.code === 'memory_full' && error.status === 409 && /Replace or forget/.test(error.message));
  const [oldest] = await memory.listMemory(full);
  const corrected = await memory.remember(full, 'Fact number zero, corrected.', { replaces: oldest.id });
  assert.equal(corrected.replaced, true, 'a full list still takes a correction');
  assert.equal((await memory.listMemory(full)).length, memory.MEMORY_MAX);
});

test('forget removes one entry and says whether there was one, only in that account', async () => {
  const mine = await account(), other = await account();
  const kept = await memory.remember(mine, 'Plays the cello on Sundays.');
  const theirs = await memory.remember(other, 'Runs a bakery.');
  // Another account's entry with the same id: this account's forget must not reach it.
  await execute({ sql: 'INSERT INTO pocket_pip_memory (user_id, id, text, chat_uid, created, updated) VALUES (?, ?, ?, ?, ?, ?)',
    args: [mine, theirs.id, 'A different fact with the same id.', '', 1, 1] });
  assert.equal(await memory.forget(mine, kept.id), true);
  assert.equal(await memory.forget(mine, kept.id), false, 'a second forget finds nothing');
  assert.deepEqual((await memory.listMemory(mine)).map(entry => entry.id), [theirs.id]);
  assert.equal(await memory.forget(mine, theirs.id), true);
  assert.deepEqual((await memory.listMemory(mine)), []);
  assert.deepEqual((await memory.listMemory(other)).map(entry => entry.text), ['Runs a bakery.'], 'the same id in another account is untouched');
  assert.equal(await memory.forget(other, theirs.id), true);
  assert.deepEqual(await memory.listMemory(other), []);
  assert.equal(await memory.forget(mine, ''), false);
});

test('the note is empty for an empty list and lists ids and texts in order', async () => {
  const userId = await account();
  assert.equal(memory.memoryNote([]), '');
  assert.equal(memory.memoryNote(await memory.listMemory(userId)), '');
  await memory.remember(userId, 'Trains for a half marathon in April.');
  await memory.remember(userId, 'Likes short answers without preamble.');
  const entries = await memory.listMemory(userId);
  assert.equal(memory.memoryNote(entries), 'What you remember about the person (your memory, newest last; the id in brackets is for replacing or forgetting):\n'
    + '- [' + entries[0].id + '] Trains for a half marathon in April.\n- [' + entries[1].id + '] Likes short answers without preamble.');
});

test('a change publishes a memory event after the write; a remember that changed nothing publishes none', async () => {
  const userId = await account(), seen = [];
  const stop = events.subscribe(userId, event => seen.push(event));
  try {
    const saved = await memory.remember(userId, 'Cycles to work.');
    assert.deepEqual(seen, [{ type: 'memory' }]);
    seen.length = 0;
    await memory.remember(userId, 'CYCLES TO WORK.');
    assert.deepEqual(seen, [], 'a fact already remembered changes nothing');
    await memory.remember(userId, 'Cycles to work every day.');
    await memory.forget(userId, saved.id);
    assert.deepEqual(seen, [{ type: 'memory' }, { type: 'memory' }]);
  } finally { stop(); }
});

test('a server reply remembers what the model saves, with the chat it was learned in', async () => {
  const userId = await account(), sent = [];
  const view = await runs.submitRun(userId, { requestId: 'req-memory', chat: header('chat-memory'), text: 'Merke dir: ich laufe im April einen Halbmarathon.', device: 'browser-1' },
    { fetcher: provider(sent, compatibleMessage({ calls: [{ name: 'remember', input: { text: '  Trains for a half   marathon in April. ' }, id: 'call_remember' }] }), compatibleMessage({ text: 'Alles klar.' })) });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.answer, 'Alles klar.');
  const entries = await memory.listMemory(userId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].text, 'Trains for a half marathon in April.');
  assert.equal(entries[0].chat, 'chat-memory');
  const row = view.run.turn.activity.find(item => item.name === 'remember');
  assert.equal(row.state, 'done');
  assert.equal(row.summary, 'remembered');
  const result = JSON.parse(row.result);
  assert.equal(result.saved, true);
  assert.equal(result.id, entries[0].id, 'the model gets the id it needs to correct or forget it');
  assert.ok(sent[0].tools.some(tool => tool.function.name === 'remember'));
});

test('the next reply reads the remembered sentence and its id, and is offered both tools', async () => {
  const userId = await account(), firstSent = [];
  await runs.submitRun(userId, { requestId: 'req-memory-first', chat: header('chat-memory-next'), text: 'Merke dir: ich laufe im April einen Halbmarathon.', device: 'browser-1' },
    { fetcher: provider(firstSent, compatibleMessage({ calls: [{ name: 'remember', input: { text: 'Trains for a half marathon in April.' }, id: 'call_remember' }] }), compatibleMessage({ text: 'Alles klar.' })) });
  const [entry] = await memory.listMemory(userId);
  assert.ok(entry);
  const sent = [];
  const second = await runs.submitRun(userId, { requestId: 'req-memory-second', chat: header('chat-memory-next'), text: 'Und die Antwort?', device: 'browser-1' },
    { fetcher: provider(sent, compatibleMessage({ text: 'Kurz.' })) });
  assert.equal(second.run.status, 'done', second.run.turn.error);
  const instructions = String(sent[0].messages[0].content);
  assert.match(instructions, new RegExp('\\[' + entry.id + '\\] Trains for a half marathon in April\\.'));
  const offered = sent[0].tools.map(tool => tool.function.name);
  assert.ok(offered.includes('remember')); assert.ok(offered.includes('forget'));
});

test('forget through a reply removes an entry, and remember with replaces corrects one', async () => {
  const userId = await account();
  const saved = await memory.remember(userId, 'Likes long answers.');
  const forgetSent = [];
  const forgotten = await runs.submitRun(userId, { requestId: 'req-memory-forget', chat: header('chat-memory-forget'), text: 'Vergiss, dass ich lange Antworten mag.', device: 'browser-1' },
    { fetcher: provider(forgetSent, compatibleMessage({ calls: [{ name: 'forget', input: { id: saved.id }, id: 'call_forget' }] }), compatibleMessage({ text: 'Vergessen.' })) });
  assert.equal(forgotten.run.status, 'done', forgotten.run.turn.error);
  assert.deepEqual(await memory.listMemory(userId), []);
  const row = forgotten.run.turn.activity.find(item => item.name === 'forget');
  assert.equal(row.state, 'done'); assert.equal(row.summary, 'forgotten'); assert.equal(JSON.parse(row.result).forgotten, true);

  const remembered = await memory.remember(userId, 'Likes long answers.');
  const correctSent = [];
  const corrected = await runs.submitRun(userId, { requestId: 'req-memory-correct', chat: header('chat-memory-forget'), text: 'Korrigiere das: kurze Antworten.', device: 'browser-1' },
    { fetcher: provider(correctSent, compatibleMessage({ calls: [{ name: 'remember', input: { text: 'Likes short answers without preamble.', replaces: remembered.id }, id: 'call_remember' }] }), compatibleMessage({ text: 'Korrigiert.' })) });
  assert.equal(corrected.run.status, 'done', corrected.run.turn.error);
  const entries = await memory.listMemory(userId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].id, remembered.id);
  assert.equal(entries[0].text, 'Likes short answers without preamble.');
  // A refusal reaches the model as an error object, never as a throw.
  const refused = await memory.memoryTool(userId, 'chat-memory-forget', 'remember', { text: '   ' });
  assert.equal(refused.error, 'memory_empty');
  assert.equal(typeof refused.message, 'string');
});

test('a scheduled job reads the memory in its instructions and can add to it', async () => {
  const userId = await account();
  await memory.remember(userId, 'Works as a landscape architect.');
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Notes', prompt: 'Summarise my notes.', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6] });
  const sent = [], replies = [
    compatibleMessage({ calls: [{ name: 'remember', input: { text: 'Is learning Italian for a trip to Rome.' }, id: 'call_job_memory' }] }),
    compatibleMessage({ text: 'Your notes are about a bike.' }),
  ];
  const fetcher = async (url, options) => { sent.push(JSON.parse(options.body)); return response(replies.shift()); };
  const result = await background.runClaimed(userId, routines[0].id, { force: true, fetcher });
  assert.equal(result.status, 'done', result.error);
  assert.match(String(sent[0].messages[0].content), /Works as a landscape architect\./);
  const offered = sent[0].tools.map(tool => tool.function.name);
  assert.ok(offered.includes('remember')); assert.ok(offered.includes('forget'));
  assert.deepEqual((await memory.listMemory(userId)).map(entry => entry.text), ['Works as a landscape architect.', 'Is learning Italian for a trip to Rome.']);
});

test('the tab path is offered neither tool, and a memory row reads remembered or already remembered', () => {
  const chat = { provider: 'compatible', baseUrl: 'https://model.example/v1', model: 'm', grants: ['notes'] };
  assert.ok(!toolNames(chat).includes('remember')); assert.ok(!toolNames(chat).includes('forget'));
  assert.ok(!toolNames({ ...chat, backgroundJob: true }).includes('remember'), 'a job is not handed the memory by its notes flag');
  const withMemory = toolNames({ ...chat, memory: true });
  assert.ok(withMemory.includes('remember')); assert.ok(withMemory.includes('forget'));
  assert.equal(summary('remember', { kind: 'memory', saved: true, id: 'm1a2b3c', text: 'x', replaced: false, added: true }), 'remembered');
  assert.equal(summary('remember', { kind: 'memory', saved: true, id: 'm1a2b3c', text: 'x', replaced: false, added: false }), 'already remembered');
  assert.equal(summary('remember', { kind: 'memory', saved: true, id: 'm1a2b3c', text: 'x', replaced: true, added: false }), 'remembered');
  assert.equal(summary('forget', { kind: 'memory', forgotten: true, id: 'm1a2b3c' }), 'forgotten');
  assert.equal(summary('forget', { kind: 'memory', forgotten: false, id: 'm1a2b3c' }), 'not remembered');
});

test('a remember call is not a lookup: it still runs when the message needs none', async () => {
  const userId = await account({ openrouter: true }), sent = [];
  const serve = provider(sent, compatibleMessage({ calls: [{ name: 'search_notes', input: { query: 'car' }, id: 'call_lookup' }] }),
    compatibleMessage({ calls: [{ name: 'remember', input: { text: 'Reads the blue car note.' }, id: 'call_memory' }] }), compatibleMessage({ text: 'Gern.' }));
  const fetcher = async (url, options) => String(url) === JEV_ENDPOINT
    ? new Response(JSON.stringify({ answers: { effort: { type: 'choice', choice: 'none' } } }), { status: 200, headers: { 'content-type': 'application/json' } })
    : serve(url, options);
  const view = await runs.submitRun(userId, { requestId: 'req-memory-effort', chat: header('chat-memory-effort'), text: 'Danke, das reicht.', device: 'browser-1' }, { fetcher });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(view.run.turn.usage.effort, 'none');
  const rows = name => view.run.turn.activity.filter(item => item.name === name);
  assert.equal(rows('search_notes')[0].state, 'done', 'the one allowed lookup runs');
  assert.equal(rows('remember')[0].state, 'done', 'remember is not refused by the lookup limit');
  assert.deepEqual((await memory.listMemory(userId)).map(entry => entry.text), ['Reads the blue car note.']);
  assert.equal(view.run.turn.answer, 'Gern.');
});

test('two things remembered in the same round are both kept, and the same thing twice at once is kept once', async () => {
  const userId = await account();
  const kept = await Promise.all([memory.remember(userId, 'Trains for a half marathon.'), memory.remember(userId, 'Likes short answers.'), memory.remember(userId, 'likes short answers.')]);
  assert.equal(kept.filter(entry => entry.added).length, 2);
  assert.deepEqual((await memory.listMemory(userId)).map(entry => entry.text).sort(), ['Likes short answers.', 'Trains for a half marathon.']);
  // A refusal does not hold up the writes behind it.
  const mixed = await Promise.allSettled([memory.remember(userId, '   '), memory.remember(userId, 'Has a sister, Lena.')]);
  assert.equal(mixed[0].status, 'rejected'); assert.equal(mixed[1].value.added, true);
});
