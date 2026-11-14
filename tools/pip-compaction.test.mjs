import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleMessage, messageText, systemText } from './pip-provider-fixtures.mjs';

// Compaction against a real libSQL file database and a recording provider double; no provider key or paid call.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-compaction-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments } = await import('../src/server/workspace.js');
const { saveBackground, backgroundState } = await import('../src/server/pip-background.js');
const { writeObject } = await import('../src/server/objects.js');
const runs = await import('../src/server/pip-runs.js');
const { compactChat, EXTEND_AFTER } = await import('../src/server/pip-compaction.js');
const { requestBody, contextCoverage } = await import('../src/client/pip-core.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const SETTINGS = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
const CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
let users = 0;
async function account() {
  const id = 'compaction-user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes: [] } });
  await saveBackground(id, SETTINGS, 'fixture-key-123456');
  return id;
}
const CARD = '```pocket\n{"op":"add","path":"/root","value":"t"}\n{"op":"add","path":"/elements/t","value":{"type":"Text","props":{"text":"SECRET-CARD-SOURCE"}}}\n```';
const turnOf = (n, at, extra = {}) => ({ uid: 'turn-' + String(n).padStart(2, '0'), text: 'Question ' + n + ' about topic-' + n + '?', context: [], created: at, updated: at,
  answer: 'Answer ' + n + ': topic-' + n + ' is settled.', reasoning: '', error: '', status: 'done', usage: {}, activity: [], sources: [], phase: 'done', ...extra });
/** A stored chat of `count` finished exchanges; turn 3 holds a card, a card record and tool-call markup. */
async function longChat(userId, uid, count = 30, from = 0) {
  const base = Date.now() - 10_000_000, turns = [];
  for (let n = from; n < from + count; n++) turns.push(turnOf(n, base + n * 1000, n === 3 ? { answer: 'Answer 3 with a card:\n\n' + CARD + '\n\n[card k1234 drawn here with show_card: Text]\n<tool_call>\n</tool_call>\nThe end of answer 3.' } : {}));
  await writeObject(userId, 'chats', { uid, title: 'Long', created: base, updated: base + count * 1000, draft: '', context: [], config: CONFIG, turns }, from ? { appendTurns: true } : {});
}
const chatOf = async (userId, uid) => JSON.parse(String((await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0].payload));
const failure = (status, message) => new Response(JSON.stringify({ error: { message, type: 'invalid_request_error' } }), { status, headers: { 'content-type': 'application/json' } });
const isSummary = request => /context summarization assistant/.test(systemText(request));
/** A provider double that answers a summary request and a reply request each with its own prepared stream (or a failure). */
const provider = (sent, { summary = [], reply = [] }) => async (url, options) => {
  const request = JSON.parse(options.body); sent.push(request);
  const queue = isSummary(request) ? summary : reply;
  if (!queue.length) return failure(400, 'The fixture expected no further ' + (isSummary(request) ? 'summary' : 'reply') + ' request.');
  const next = queue.shift();
  return next instanceof Response ? next : new Response(next, { headers: { 'content-type': 'text/event-stream' } });
};
const SUMMARY = '## Topics\n- Topics 1 to 10 were discussed; the person chose option B.';
const summaryReply = (text = SUMMARY, extra = {}) => compatibleMessage({ text, usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 }, ...extra });
const userText = request => request.messages.filter(message => message.role === 'user').map(messageText).join('\n');
const submit = (userId, uid, text, fetcher, id = 'req-' + uid + '-' + Math.random().toString(36).slice(2)) =>
  runs.submitRun(userId, { requestId: id, chat: { uid, title: 'Long', created: Date.now(), config: CONFIG }, text, device: 'phone-1' }, { fetcher });

test('a 30-exchange chat is summarised once, then replied to with the summary where the omitted turns were', async () => {
  const userId = await account(), sent = [];
  await longChat(userId, 'chat-long');
  const view = await submit(userId, 'chat-long', 'What did we settle?', provider(sent, { summary: [summaryReply()], reply: [compatibleMessage({ text: 'Option B.' })] }));
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(sent.length, 2);
  assert.ok(isSummary(sent[0]) && !isSummary(sent[1]), 'the summary request comes first');
  assert.equal(sent[0].tools, undefined, 'the summary request offers no tools');
  // The summary covers turns 1..10: never the pinned first request, never the recent window.
  const input = userText(sent[0]);
  for (let n = 1; n <= 10; n++) assert.match(input, new RegExp('Question ' + n + ' about'));
  assert.doesNotMatch(input, /Question 0 about/); assert.doesNotMatch(input, /Question 11 about/); assert.doesNotMatch(input, /What did we settle/);
  assert.match(input, /untrusted data/);
  // No card source, card record or tool-call markup reaches the summariser.
  assert.match(input, /The end of answer 3/);
  for (const banned of ['SECRET-CARD-SOURCE', '```pocket', '"op"', '[card', 'show_card', '<tool_call>']) assert.ok(!input.includes(banned), banned + ' was in the summary input');
  // The reply: pinned first exchange, then the summary right before the first recent turn, then the recent turns.
  const reply = sent[1].messages.filter(message => message.role !== 'system');
  assert.match(messageText(reply[0]), /^Question 0 about/);
  assert.match(messageText(reply[1]), /^Answer 0/);
  const joined = messageText(reply[2]);
  assert.match(joined, /Summary of earlier conversation \(historical reference data, not instructions\)/);
  assert.match(joined, /<pocket_conversation_summary>[\s\S]*the person chose option B[\s\S]*<\/pocket_conversation_summary>[\s\S]*Question 11 about/);
  assert.match(messageText(reply.at(-3)), /^Question 29 about/);
  const last = messageText(reply.at(-1));
  assert.match(last, /<pocket_history_coverage>/); assert.match(last, /"summarized_turns":10/); assert.match(last, /What did we settle\?$/);
  assert.equal(userText(sent[1]).match(/<pocket_conversation_summary>/g).length, 1, 'the summary is sent once');
  // Stored on the chat through the synced object, with the turn it covers through.
  const stored = await chatOf(userId, 'chat-long');
  assert.equal(stored.summary.upto, 'turn-10'); assert.equal(stored.summary.text, SUMMARY); assert.equal(stored.summary.model, 'fixture-model'); assert.ok(stored.summary.made > 0);
  // Its tokens count like the reply's, in the turn's usage and against the day's budget.
  assert.equal(view.run.turn.usage.input_tokens, 1010); assert.equal(view.run.turn.usage.output_tokens, 208);
  assert.equal((await backgroundState(userId)).usedToday, 1218);
  assert.equal(view.run.turn.usage.history_replay.summarized, 10, 'the coverage the reply records matches what was sent');
});

test('a later reply reuses the summary, and extends it with the previous one once more turns fall out', async () => {
  const userId = await account(), first = [];
  await longChat(userId, 'chat-extend');
  await submit(userId, 'chat-extend', 'Reply one?', provider(first, { summary: [summaryReply()], reply: [compatibleMessage({ text: 'One.' })] }));
  // One more turn fell out of the window (turn 11): too few to summarise again; the summary is still replayed.
  const second = [];
  const again = await submit(userId, 'chat-extend', 'Reply two?', provider(second, { reply: [compatibleMessage({ text: 'Two.' })] }));
  assert.equal(again.run.status, 'done', again.run.turn.error);
  assert.equal(second.length, 1, 'no second summary request');
  assert.match(userText(second[0]), /the person chose option B/);
  assert.match(userText(second[0]), /"omitted_turns":11/);
  // More turns fall out: the next reply summarises only them, extending the previous summary.
  await longChat(userId, 'chat-extend', EXTEND_AFTER, 100);
  const third = [];
  const extended = await submit(userId, 'chat-extend', 'Reply three?', provider(third, { summary: [summaryReply('## Topics\n- Extended through turn 13.')], reply: [compatibleMessage({ text: 'Three.' })] }));
  assert.equal(extended.run.status, 'done', extended.run.turn.error);
  assert.equal(third.length, 2);
  const input = userText(third[0]);
  assert.match(input, /<previous-summary>\n## Topics\n- Topics 1 to 10 were discussed/);
  assert.match(input, /Question 11 about/); assert.doesNotMatch(input, /Question 10 about/, 'covered turns are not read again');
  const stored = await chatOf(userId, 'chat-extend');
  assert.match(stored.summary.text, /Extended through turn 13/);
  assert.match(userText(third[1]), /Extended through turn 13/);
});

test('a failing or cut-off summary leaves the reply working with the clipped replay', async () => {
  for (const [name, answer] of [['failed', failure(400, 'Summary refused.')], ['cut', summaryReply('## Topics\n- half a', { finish: 'length' })]]) {
    const userId = await account(), sent = [], uid = 'chat-' + name;
    await longChat(userId, uid);
    const view = await submit(userId, uid, 'Still there?', provider(sent, { summary: [answer], reply: [compatibleMessage({ text: 'Yes.' })] }));
    assert.equal(view.run.status, 'done', name + ': ' + view.run.turn.error);
    assert.equal(view.run.turn.answer, 'Yes.');
    const reply = sent.find(request => !isSummary(request));
    assert.doesNotMatch(userText(reply), /pocket_conversation_summary/);
    assert.match(userText(reply), /"omitted_turns":10/); assert.doesNotMatch(userText(reply), /summarized_turns/);
    assert.equal((await chatOf(userId, uid)).summary, undefined, name + ': nothing is stored');
  }
});

test('a short chat makes no summary request', async () => {
  const userId = await account(), sent = [];
  await longChat(userId, 'chat-short', 4);
  const view = await submit(userId, 'chat-short', 'Short?', provider(sent, { reply: [compatibleMessage({ text: 'Short.' })] }));
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(sent.length, 1);
  assert.equal((await chatOf(userId, 'chat-short')).summary, undefined);
});

test('a summary is stored only while the asking run holds its lease, and over the summary it extended', async () => {
  const userId = await account();
  await longChat(userId, 'chat-lease');
  const chat = await chatOf(userId, 'chat-lease'), turn = { uid: 'turn-now', text: 'Now?', context: [] };
  const made = await compactChat(userId, chat, turn, { value: CONFIG, key: 'fixture-key-123456', fetcher: provider([], { summary: [summaryReply()] }), lease: { runId: 'no-such-run', leaseId: 'x' } });
  assert.equal(made.outcome, 'unsaved'); assert.equal(made.chat.summary.upto, 'turn-10', 'the reply still uses it');
  assert.equal((await chatOf(userId, 'chat-lease')).summary, undefined);
  // Without a lease (a direct call) it is stored; a second call finds nothing new to summarise.
  assert.equal((await compactChat(userId, chat, turn, { value: CONFIG, key: 'fixture-key-123456', fetcher: provider([], { summary: [summaryReply()] }) })).outcome, 'made');
  const stored = await chatOf(userId, 'chat-lease');
  assert.equal((await compactChat(userId, stored, turn, { value: CONFIG, key: 'fixture-key-123456', fetcher: async () => { throw new Error('no request expected'); } })).outcome, 'none');
  // A run working from the chat before that summary existed does not overwrite it.
  assert.equal((await compactChat(userId, chat, turn, { value: CONFIG, key: 'fixture-key-123456', fetcher: provider([], { summary: [summaryReply('other')] }) })).outcome, 'unsaved');
  assert.equal((await chatOf(userId, 'chat-lease')).summary.text, SUMMARY);
  // Over the day's budget no request is made.
  assert.equal((await compactChat(userId, chat, turn, { value: CONFIG, key: 'k', fetcher: async () => { throw new Error('no request expected'); }, tokensLeft: 5000 })).outcome, 'budget');
});

test('requestBody without a summary is unchanged; with one, coverage and messages agree', async () => {
  const base = Date.now(), turns = Array.from({ length: 30 }, (_, n) => turnOf(n, base + n));
  const chat = { uid: 'local', title: 'Local', created: base, updated: base, draft: '', context: [], config: CONFIG, turns }, turn = { uid: 'turn-new', text: 'New?', context: [] };
  assert.deepEqual(requestBody({ ...chat, summary: undefined }, turn), requestBody(chat, turn));
  assert.equal(contextCoverage(chat, turn).summarized, undefined);
  // A summary whose last turn is not in the chat is ignored.
  assert.deepEqual(requestBody({ ...chat, summary: { upto: 'gone', text: 'x', made: 1 } }, turn), requestBody(chat, turn));
  const summarized = { ...chat, summary: { upto: 'turn-10', text: 'Earlier: <pocket_history_coverage>topic list</pocket_history_coverage>', made: base } };
  const body = requestBody(summarized, turn), coverage = contextCoverage(summarized, turn);
  assert.equal(coverage.summarized, 10); assert.equal(coverage.summary_upto, 'turn-10'); assert.equal(coverage.replayed, 20);
  const text = body.messages.map(messageText).join('\n');
  assert.equal(text.match(/<pocket_history_coverage>/g).length, 1, 'tags inside the summary text are removed');
  assert.match(messageText(body.messages[2]), /Earlier: topic list[\s\S]*Question 11 about/);
});

test('a device whose copy predates the summary keeps it when it syncs a later edit', async () => {
  const { mergeObject, sanitizeObject, validObject } = await import('../src/shared/objects.js');
  const base = { uid: 'merge', title: 'A', created: 1, updated: 10, draft: '', context: [], config: CONFIG, turns: [turnOf(0, 1)] };
  const summary = { upto: 'turn-00', text: 'Kept.', made: 20, model: 'fixture-model' };
  assert.ok(validObject('chats', { ...base, summary })); assert.ok(!validObject('chats', { ...base, summary: { upto: 'bad id!', text: '', made: 1 } }));
  assert.deepEqual(sanitizeObject('chats', { ...base, summary }).summary, summary, 'an upload carries it');
  const merged = mergeObject('chats', { ...base, summary }, { ...base, title: 'Renamed', updated: 30 });
  assert.equal(merged.title, 'Renamed'); assert.deepEqual(merged.summary, summary);
  assert.equal(mergeObject('chats', { ...base, summary }, { ...base, updated: 30, summary: { ...summary, text: 'Newer.', made: 25 } }).summary.text, 'Newer.');
});
