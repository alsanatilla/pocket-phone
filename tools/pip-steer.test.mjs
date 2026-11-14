import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleMessage, response } from './pip-provider-fixtures.mjs';

// Talking to Pip while it works (docs/pip-agent-runtime.md, "Steering"): a message sent into a running reply reaches
// the model at its next step. The real OpenClaw Agent, a real libSQL file and a provider double, as in
// pip-runs.test.mjs; each test has its own account and leaves no running run behind.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-steer-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments, readDocuments } = await import('../src/server/workspace.js');
const { saveBackground } = await import('../src/server/pip-background.js');
const runs = await import('../src/server/pip-runs.js');
const { streamChat, MAX_REQUESTS } = await import('../src/server/pip-agent.js');
const { config, DEFAULT_CONFIG, requestBody } = await import('../src/client/pip-core.js');
const { steerText, MAX_STEERS } = await import('../src/shared/pip-steer.js');
const { replyOf, diffReply, applyOps, emptyReply } = await import('../src/shared/pip-blocks.js');
const { sanitizeObject } = await import('../src/shared/objects.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const SETTINGS = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks'], dailyTokens: 500000, timezone: 'Europe/Berlin', enabled: true };
const CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
let users = 0;
async function account() {
  const id = 'steer-user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes: [{ uid: 'note-weekend', text: '# Weekend\n\nSaturday is free.', pinned: false, created: now, updated: now, deleted: false }] }, 'agenda.json': { v: 1, events: [] } });
  await saveBackground(id, SETTINGS, 'fixture-key-123456');
  return id;
}
const header = uid => ({ uid, title: 'Steer', created: Date.now(), config: CONFIG });
const chatOf = async (userId, uid) => JSON.parse(String((await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0].payload));
const notesOf = async userId => (await readDocuments(userId))['notes.json'].value.notes.filter(note => note.uid.startsWith('pip-'));
/** A message from the person: a new turn, or (with `steer`, the running turn's uid) one sent into that reply. */
const send = (userId, chat, requestId, text, fetcher, extra = {}) => runs.submitRun(userId, { requestId, chat: header(chat), text, device: 'phone-1', turnUid: 'turn-' + requestId, ...extra }, { fetcher });
const userTexts = request => request.messages.filter(message => message.role === 'user').map(message => String(message.content));
const MARK = steerText('').trim();
/**
 * A provider double that checks tool messages follow their calls (as a chat-completions endpoint does) and answers each
 * request with the next reply: a wire, or a function of the request that returns one (it may send a message first).
 */
const provider = (sent, ...replies) => async (_url, options) => {
  const request = JSON.parse(options.body); sent.push(request);
  const open = new Set();
  for (const message of request.messages) {
    if (message.role === 'tool') { assert.ok(open.delete(message.tool_call_id), 'a tool message follows its call'); continue; }
    assert.equal(open.size, 0, 'every call is answered before the next message');
    for (const call of message.role === 'assistant' ? message.tool_calls || [] : []) open.add(call.id);
  }
  assert.ok(replies.length, 'the fixture expected no further request');
  const next = replies.shift();
  return response(typeof next === 'function' ? await next(request, options) : next);
};
const lookup = (id, query, text = '') => compatibleMessage({ text, calls: [{ name: 'search_notes', input: { query }, id }] });
const plan = id => compatibleMessage({ calls: [{ name: 'update_plan', input: { steps: [{ text: 'Answer', status: 'active' }] }, id }] });
const write = (id = 'call_write') => compatibleMessage({ calls: [{ name: 'create_record', input: { kind: 'note', title: 'Blue car', text: '21,000 euros' }, id }] });
const steersOf = async (userId, runId) => (await execute({ sql: "SELECT request_id, status, json_extract(config, '$.steer') AS steer FROM pocket_pip_runs WHERE user_id = ? AND json_extract(config, '$.steer') = ? ORDER BY created", args: [userId, runId] })).rows.map(row => [String(row.request_id), String(row.status)]);

// 1, 2: delivery between steps, and the reply carries on.
test('a message sent during a tool round reaches the next request as the person’s own, and the same reply carries on', async () => {
  const userId = await account(), sent = [];
  let steered;
  const view = await send(userId, 'chat-round', 'round-1', 'Is Saturday free?', provider(sent,
    async () => { steered = await send(userId, 'chat-round', 'round-2', 'Also check Sunday.', null, { steer: 'turn-round-1' }); return lookup('call_1', 'saturday', 'Let me look.'); },
    compatibleMessage({ text: 'Saturday is free; Sunday has nothing either.' })));
  assert.equal(steered.run.status, 'waiting', 'accepted while the reply worked');
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(sent.length, 2, 'one reply, no second run');
  // The second request: the question, the lookup and its result, then the person's message marked as mid-reply.
  const last = sent[1].messages.at(-1);
  assert.equal(last.role, 'user'); assert.ok(String(last.content).startsWith(MARK)); assert.match(String(last.content), /Also check Sunday\.$/);
  assert.equal(sent[1].messages.at(-2).role, 'tool');
  const turn = view.run.turn;
  assert.equal(turn.answer, 'Saturday is free; Sunday has nothing either.');
  assert.match(turn.reasoning, /Let me look\./, 'the text before the lookup is working notes, as before');
  assert.equal(turn.steers.length, 1);
  assert.deepEqual([turn.steers[0].uid, turn.steers[0].text, turn.steers[0].pos], ['turn-round-2', 'Also check Sunday.', 0]);
  assert.ok(turn.steers[0].taken >= turn.steers[0].at);
  // Taken, not queued: the message is no turn of its own and no longer waits.
  assert.deepEqual(await steersOf(userId, view.run.runId), [['round-2', 'steered']]);
  assert.equal((await runs.queueView(userId, { chat: 'chat-round' })).queue.length, 0);
  const chat = await chatOf(userId, 'chat-round');
  assert.deepEqual(chat.turns.map(item => [item.text, item.steers?.length || 0]), [['Is Saturday free?', 1]]);
  const events = (await runs.runView(userId, { request: 'round-2' })).events.map(item => item.kind);
  assert.deepEqual(events, ['waiting', 'steered']);
  // The person's next question replays the steered turn in order.
  const next = [];
  await send(userId, 'chat-round', 'round-3', 'Thanks. And next week?', provider(next, compatibleMessage({ text: 'Next week is open.' })));
  const asked = userTexts(next[0]);
  assert.match(asked[0], /Is Saturday free\?/);
  assert.ok(asked[1].startsWith(MARK) && asked[1].endsWith('Also check Sunday.'), 'the message stands after the question');
  assert.match(asked[2], /And next week\?/);
});

test('a message sent while the last words are written continues the same reply after them', async () => {
  const userId = await account(), sent = [];
  const view = await send(userId, 'chat-tail', 'tail-1', 'Is Saturday free?', provider(sent,
    async () => { await send(userId, 'chat-tail', 'tail-2', 'And Sunday?', null, { steer: 'turn-tail-1' }); return compatibleMessage({ text: 'Saturday is free.' }); },
    compatibleMessage({ text: 'Sunday is free too.' })));
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].messages.slice(-2).map(message => [message.role, String(message.content)]), [['assistant', 'Saturday is free.'], ['user', steerText('And Sunday?')]]);
  // What was written stays; the message stands after it and the answer goes on below.
  assert.equal(view.run.turn.answer, 'Saturday is free.\n\nSunday is free too.');
  assert.equal(view.run.turn.steers[0].pos, 'Saturday is free.'.length);
  // The live blocks cut the answer at the message, so a follower draws it in its place.
  const state = replyOf(view.run.turn);
  assert.deepEqual([state.blocks.map(block => block.body), state.steers[0].block], [['Saturday is free.', 'Sunday is free too.'], 1]);
  const follower = emptyReply();
  assert.ok(applyOps(follower, diffReply(emptyReply(), state)));
  assert.deepEqual(follower.steers.map(item => item.block), [1]);
  // A later reply replays the steered turn: answer, message, answer.
  const next = [];
  await send(userId, 'chat-tail', 'tail-3', 'Good.', provider(next, compatibleMessage({ text: 'Enjoy.' })));
  assert.deepEqual(next[0].messages.slice(2, 6).map(message => [message.role, String(message.content).replace(/^[\s\S]*Current user request:\n/, '')]),
    [['assistant', 'Saturday is free.'], ['user', steerText('And Sunday?')], ['assistant', 'Sunday is free too.'], ['user', 'Good.']]);
});

// 1, 2: exactly once across an approval, and held while the approval waits.
test('a message sent while a change waits for a decision is held, decides nothing, and reaches the model once when the reply continues', async () => {
  const userId = await account(), sent = [];
  const first = await send(userId, 'chat-held', 'held-1', 'Save the blue car price as a note.', provider(sent, write()));
  assert.equal(first.run.status, 'awaiting', first.run.turn.error);
  const steered = await send(userId, 'chat-held', 'held-2', 'Call it Blue car, checked.', null, { steer: 'turn-held-1' });
  assert.equal(steered.run.status, 'waiting');
  const queue = await runs.queueView(userId, { chat: 'chat-held' });
  assert.deepEqual(queue.queue.map(item => [item.text, item.steer]), [['Call it Blue car, checked.', 'turn-held-1']]);
  assert.equal(queue.active, 'awaiting');
  // Nothing is approved or declined by it, and the sweep does not start or deliver it.
  await runs.sweepRuns({ fetcher: async () => { throw new Error('nothing may be asked while the change waits'); } });
  const waiting = await runs.runView(userId, { runId: first.run.runId });
  assert.equal(waiting.run.status, 'awaiting'); assert.deepEqual(waiting.requests.map(item => item.state), ['pending']);
  assert.deepEqual(waiting.run.turn.steers ?? [], []);
  const decided = await runs.decideRun(userId, { runId: first.run.runId, requestId: first.requests[0].id, approved: true, device: 'phone-1' },
    { fetcher: provider(sent, compatibleMessage({ text: 'Saved it; I will call it Blue car, checked next time.' })) });
  assert.equal(decided.run.status, 'done', decided.run.turn.error);
  assert.equal((await notesOf(userId)).length, 1, 'the approved change was saved once');
  assert.equal(sent.length, 2);
  // After the saved result, the person's message, once.
  assert.deepEqual(sent[1].messages.slice(-2).map(message => message.role), ['tool', 'user']);
  assert.match(String(sent[1].messages.at(-2).content), /"status":"saved"/);
  assert.equal(userTexts(sent[1]).filter(text => text.includes('Blue car, checked')).length, 1);
  assert.deepEqual(decided.run.turn.steers.map(item => item.uid), ['turn-held-2']);
  assert.deepEqual((await chatOf(userId, 'chat-held')).turns.map(item => item.text), ['Save the blue car price as a note.']);
});

test('a message taken before a pause is in the checkpoint and reaches the model once after the decision', async () => {
  const userId = await account(), sent = [];
  const first = await send(userId, 'chat-pause', 'pause-1', 'Look up the blue car.', provider(sent,
    async () => { await send(userId, 'chat-pause', 'pause-2', 'And save its price as a note.', null, { steer: 'turn-pause-1' }); return lookup('call_look', 'blue car'); },
    write()));
  assert.equal(first.run.status, 'awaiting', first.run.turn.error);
  assert.equal(first.run.turn.steers.length, 1, 'taken before the second request');
  assert.equal(userTexts(sent[1]).filter(text => text.startsWith(MARK)).length, 1);
  const decided = await runs.decideRun(userId, { runId: first.run.runId, requestId: first.requests[0].id, approved: true, device: 'phone-1' },
    { fetcher: provider(sent, compatibleMessage({ text: 'Saved.' })) });
  assert.equal(decided.run.status, 'done', decided.run.turn.error);
  assert.equal(sent.length, 3);
  assert.equal(userTexts(sent[2]).filter(text => text.startsWith(MARK)).length, 1, 'once, from the checkpoint');
  assert.deepEqual(await steersOf(userId, first.run.runId), [['pause-2', 'steered']]);
});

// 1: exactly once across a worker restart.
test('a message taken before the process stopped reaches the restarted reply once and never becomes a queued message', async () => {
  const userId = await account(), sent = [];
  let runId = '';
  const view = await send(userId, 'chat-restart', 'restart-1', 'Is Saturday free?', provider(sent,
    async () => { await send(userId, 'chat-restart', 'restart-2', 'Also check Sunday.', null, { steer: 'turn-restart-1' }); return lookup('call_r1', 'saturday'); },
    // The second request: the message is in it; then the process is stopped mid-request (a deploy).
    async (_request, options) => {
      runId = (await runs.runView(userId, { request: 'restart-1' })).run.runId;
      await runs.releaseRuns();
      await new Promise(resolve => options.signal?.aborted ? resolve() : options.signal?.addEventListener('abort', resolve, { once: true }));
      return compatibleMessage({ text: 'never read' });
    }));
  assert.equal(view.run.status, 'running', 'let go, not ended');
  assert.equal(view.run.turn.steers.length, 1);
  // The next process sweeps: the reply starts again from its record, with the message it had taken.
  const again = [];
  const swept = await runs.sweepRuns({ fetcher: provider(again, compatibleMessage({ text: 'Saturday and Sunday are free.' })) });
  assert.equal(swept.restarted, 1);
  const done = await runs.runView(userId, { runId });
  assert.equal(done.run.status, 'done', done.run.turn.error);
  assert.equal(again.length, 1, 'the restarted reply asked once, and nothing else ran');
  assert.equal(userTexts(again[0]).filter(text => text.startsWith(MARK)).length, 1, 'the taken message is in the rebuilt request once');
  assert.ok(userTexts(again[0]).at(-1).endsWith('Also check Sunday.'));
  assert.deepEqual(done.run.turn.steers.map(item => [item.uid, item.pos]), [['turn-restart-2', 0]]);
  assert.deepEqual(await steersOf(userId, runId), [['restart-2', 'steered']]);
  assert.deepEqual((await chatOf(userId, 'chat-restart')).turns.map(item => item.text), ['Is Saturday free?']);
});

// 2, 3: a message the reply can no longer take is the next queued message; limits hold.
test('a message sent at the last request is not taken: the reply ends at its ceiling and the message runs next, once', async () => {
  const userId = await account(), sent = [];
  const rounds = Array.from({ length: MAX_REQUESTS }, (_, index) => index === MAX_REQUESTS - 1
    ? async () => { await send(userId, 'chat-ceiling', 'ceiling-2', 'Also check Sunday.', null, { steer: 'turn-ceiling-1' }); return plan('plan_' + index); }
    : plan('plan_' + index));
  const view = await send(userId, 'chat-ceiling', 'ceiling-1', 'Plan my weekend.', provider(sent, ...rounds, compatibleMessage({ text: 'Sunday is free.' })));
  // The ceiling held: twelve requests for the reply, then one for the message as its own turn.
  assert.equal(sent.length, MAX_REQUESTS + 1);
  assert.ok(sent.slice(0, MAX_REQUESTS).every(request => !userTexts(request).some(text => text.startsWith(MARK))), 'never delivered into the reply');
  assert.ok(userTexts(sent.at(-1)).at(-1).endsWith('Also check Sunday.') && !userTexts(sent.at(-1)).at(-1).startsWith(MARK), 'asked as its own message');
  assert.equal((await runs.runView(userId, { runId: view.run.runId })).run.status, 'failed');
  const chat = await chatOf(userId, 'chat-ceiling');
  assert.deepEqual(chat.turns.map(item => [item.text, item.status, item.steers?.length || 0]), [['Plan my weekend.', 'failed', 0], ['Also check Sunday.', 'done', 0]]);
  assert.equal((await runs.runView(userId, { request: 'ceiling-2' })).run.status, 'done');
});

test('a message sent while the reply is stopping waits as an ordinary message, and a reply takes at most five', async () => {
  const userId = await account(), sent = [];
  const first = await send(userId, 'chat-five', 'five-1', 'Save the blue car price as a note.', provider(sent, write()));
  // Five were already taken into this reply (as the turn records them): the sixth waits its turn.
  for (let index = 0; index < MAX_STEERS; index++) {
    await execute({ sql: `INSERT INTO pocket_pip_runs (user_id, run_id, chat_uid, request_id, turn_uid, device, status, turn, checkpoint, config, device_tools, lease_id, lease_until, expires_at, created, updated)
      VALUES (?, ?, 'chat-five', ?, ?, 'phone-1', 'steered', '{}', NULL, ?, '[]', '', 0, 0, ?, ?)`, args: [userId, 'five-taken-' + index, 'five-taken-' + index, 'five-turn-' + index, JSON.stringify({ lane: 'chat-five', steer: first.run.runId }), Date.now(), Date.now()] });
  }
  await send(userId, 'chat-five', 'five-6', 'One more thing.', null, { steer: 'turn-five-1' });
  // A message naming a turn that is not the one running is queued, too.
  await send(userId, 'chat-five', 'five-7', 'Unrelated.', null, { steer: 'turn-elsewhere' });
  assert.deepEqual((await runs.queueView(userId, { chat: 'chat-five' })).queue.map(item => [item.text, item.steer]), [['One more thing.', ''], ['Unrelated.', '']]);
  // Stop still stops: the reply ends and what waits is held, as before.
  await runs.stopRun(userId, { runId: first.run.runId, device: 'phone-1' });
  assert.deepEqual((await runs.queueView(userId, { chat: 'chat-five' })).queue.map(item => item.state), ['held', 'held']);
  await runs.changeQueue(userId, { action: 'clear', chat: 'chat-five' });
});

test('a message with attached sources, or one into a reply that is stopping, waits its turn', async () => {
  const userId = await account(), sent = [];
  const first = await send(userId, 'chat-stopping', 'stopping-1', 'Save the blue car price as a note.', provider(sent, write()));
  await send(userId, 'chat-stopping', 'stopping-2', 'See this.', null, { steer: 'turn-stopping-1', context: [{ kind: 'note', uid: 'note-weekend', title: 'Weekend', text: 'Saturday is free.' }] });
  await execute({ sql: "UPDATE pocket_pip_runs SET status = 'stopping', lease_id = 'gone', lease_until = ? WHERE user_id = ? AND run_id = ?", args: [Date.now() + 60000, userId, first.run.runId] });
  await send(userId, 'chat-stopping', 'stopping-3', 'Never mind.', null, { steer: 'turn-stopping-1' });
  assert.deepEqual((await runs.queueView(userId, { chat: 'chat-stopping' })).queue.map(item => [item.text, item.steer]), [['See this.', ''], ['Never mind.', '']]);
  await execute({ sql: "UPDATE pocket_pip_runs SET status = 'stopped', lease_id = '', lease_until = 0 WHERE user_id = ? AND run_id = ?", args: [userId, first.run.runId] });
  await execute({ sql: "UPDATE pocket_pip_runs SET status = 'withdrawn' WHERE user_id = ? AND status = 'waiting'", args: [userId] });
});

// The loop itself, without a database: the "enough" judge's stop is lifted, nothing else is, and jobs are unchanged.
const value = config({ ...DEFAULT_CONFIG, provider: 'compatible', baseUrl: 'https://model.example/v1', model: 'fixture-model' });
const setup = tools => {
  const chat = { uid: 'chat', config: value, turns: [] }, turn = { uid: 'turn-' + Math.random().toString(36).slice(2), text: 'Question' };
  return { chat, turn, options: { value, key: 'fixture', body: { instructions: 'Answer.', tools, messages: [{ role: 'user', content: turn.text }] },
    executeTool: async (_value, name, args, ...rest) => name === 'read_chat_history' ? { kind: 'history', results: [{ title: 'Earlier', text: 'Found ' + (args.query || '') }] } : (await import('../src/client/pip-tools.js')).execute(_value, name, args, ...rest) } };
};
const history = (id, query) => compatibleMessage({ calls: [{ name: 'read_chat_history', input: { query }, id }] });

test('research the “enough” judge stopped starts again when the person sends more; the request ceiling still counts every request', async () => {
  const { chat, turn, options } = setup(['read_chat_history']), sent = [], taken = [];
  let takes = 0;
  const steering = { take: async ({ pos }) => (++takes === 3 ? [{ uid: 'more', text: 'Look further back, please.', at: 1, taken: 2, pos }] : []) };
  const result = await streamChat(chat, turn, { ...options, steering, research: { enough: async () => true },
    executeTool: async (...args) => { taken.push(args[2].query); return options.executeTool(...args); },
    fetcher: provider(sent, history('h1', 'first'), history('h2', 'second'), history('h3', 'third'), compatibleMessage({ text: 'Found it further back.' })) });
  assert.equal(result.answer, 'Found it further back.');
  // The judge said enough after the first lookup: the second was refused. The message came before the third request,
  // and the third lookup ran again.
  assert.deepEqual(taken, ['first', 'third']);
  assert.match(String(sent[2].messages.find(message => message.role === 'tool' && String(message.content).includes('research_budget_reached'))?.content), /research_budget_reached/);
  assert.ok(userTexts(sent[2]).at(-1).endsWith('Look further back, please.'));
  assert.equal(result.steers[0].pos, 0);
});

test('a reply with no steering source (a scheduled job, an assignment) is unchanged: no steers, no takes', async () => {
  const { chat, turn, options } = setup([]), sent = [];
  const result = await streamChat(chat, turn, { ...options, fetcher: provider(sent, compatibleMessage({ text: 'Done.' })) });
  assert.equal(result.answer, 'Done.');
  assert.equal('steers' in result, false);
});

test('a card drawn before a message stays before it; the stored form cleans each part and the synced chat keeps the messages', async () => {
  const { chat, turn, options } = setup(['show_card', 'update_card']), sent = [];
  const card = { root: 'main', elements: [
    { id: 'main', type: 'Stack', props: { direction: 'vertical' }, children: ['km'] },
    { id: 'km', type: 'Chart', props: { kind: 'line', title: 'Weekly distance', unit: 'km', data: [{ label: 'W1', value: 22 }, { label: 'W2', value: 26 }] }, children: [] }] };
  let takes = 0;
  const steering = { take: async ({ pos }) => (++takes === 2 ? [{ uid: 'sun', text: 'And Sunday?', at: 1, taken: 2, pos }] : []) };
  const result = await streamChat(chat, turn, { ...options, steering, fetcher: provider(sent,
    compatibleMessage({ text: 'Saturday:', calls: [{ name: 'show_card', input: card, id: 'c1' }] }),
    compatibleMessage({ text: 'Sunday is free too.  \n\n\n' })) });
  const [before, after] = result.answer.split('Sunday is free too.');
  assert.equal(after, '');
  assert.equal(result.answer.slice(result.steers[0].pos).trim(), 'Sunday is free too.');
  assert.match(before, /^Saturday:\n\n```pocket\n/);
  // The synced chat keeps the steers, bounded.
  const stored = sanitizeObject('chats', { uid: 'c', title: 't', created: 1, updated: 2, draft: '', config: value, context: [], turns: [{ uid: 'u', text: 'q', answer: result.answer, status: 'done', created: 1, steers: [...result.steers, { text: 'not taken' }] }] });
  assert.deepEqual(stored.turns[0].steers.map(item => item.uid), ['sun']);
});

test('history replay of a steered turn: answer, the message as the model read it, the rest; an unfinished one replays as before', () => {
  const turn = { uid: 't1', text: 'Is Saturday free?', answer: 'Saturday is free.\n\nSunday too.', status: 'done', created: 1, activity: [], steers: [{ uid: 's1', text: 'And Sunday?', at: 2, taken: 3, pos: 17 }] };
  const chat = { uid: 'c', config: value, turns: [turn, { uid: 't2', text: 'Thanks.', created: 4 }] };
  const body = requestBody(chat, chat.turns[1]);
  assert.deepEqual(body.messages.map(message => [message.role, String(message.content)]),
    [['user', 'Is Saturday free?'], ['assistant', 'Saturday is free.'], ['user', steerText('And Sunday?')], ['assistant', 'Sunday too.'], ['user', 'Thanks.']]);
  const failed = requestBody({ ...chat, turns: [{ ...turn, status: 'failed' }, chat.turns[1]] }, chat.turns[1]);
  assert.equal(failed.messages.filter(message => message.role === 'user').length, 2);
});
