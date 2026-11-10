import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The chat log: the events between two states of a chat, and their numbered storage. A real libSQL file database;
// no Turso account or provider key is used.
const folder = mkdtempSync(join(tmpdir(), 'pocket-chat-log-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { appendChatEvents, readChatEvents, trimChatEvents } = await import('../src/server/chat-log.js');
const { chatEvents, applyChatEvents } = await import('../src/shared/chat-log.js');
const { canonical, sanitizeObject } = await import('../src/shared/objects.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

let users = 0;
async function account() {
  const id = 'chat-log-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  return id;
}
async function append(userId, chatUid, events, at = Date.now()) {
  const tx = await database().transaction('write');
  try { const written = await appendChatEvents(tx, userId, chatUid, events, at); await tx.commit(); return written; }
  catch (error) { await tx.rollback().catch(() => {}); throw error; }
  finally { tx.close(); }
}
const freeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) freeze(item);
  return value;
};

const config = (over = {}) => ({ provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false, ...over });
const context = [{ kind: 'note', uid: 'n1', title: 'Bike', text: 'The red bike costs 900 euros.', href: '/notes/n1' }];
const chat = over => sanitizeObject('chats', { uid: 'chat-1', title: 'Bike', created: 1000, updated: 1000, draft: '', config: config(), context, turns: [], ...over });
const turn = (uid, over = {}) => ({ uid, text: 'How much is the bike?', answer: '', status: 'streaming', created: 1000, updated: 1000, context: [], ...over });
const next = (previous, over) => sanitizeObject('chats', { ...previous, ...over });

// One chat through the changes the log must cover: new, turns and their fields, chat fields, config, order, delete.
const t1 = turn('t1', { created: 1000, updated: 1000, answer: 'Checking', error: 'Old failure' });
const t2 = turn('t2', { created: 1100, updated: 1100 });
const s1 = chat({ turns: [t1] });
const s2 = next(s1, { updated: 1100, turns: [t1, t2] });
const s3 = next(s2, { updated: 1200, turns: [t1, turn('t2', { created: 1100, updated: 1200, answer: '900 euros', status: 'done', usage: { input_tokens: 10, output_tokens: 5 } })] });
const t2answered = { ...s3.turns[1] };
delete t2answered.usage;
const s4 = next(s3, { updated: 1300, turns: [s3.turns[0], t2answered] });
const s5 = next(s4, { updated: 1400, title: 'Bike and price', pinned: true });
const s6 = next(s5, { updated: 1500, config: config({ model: 'other-model' }) });
const s7 = next(s6, { updated: 1600, turns: [s6.turns[1]] });
const t3 = turn('t3', { created: 900, updated: 1700, answer: 'An earlier question', status: 'done' });
const s8 = next(s7, { updated: 1700, turns: [s7.turns[0], t3] });
const s8b = next(s8, { turns: [s8.turns[1], s8.turns[0]] });
const s9 = sanitizeObject('chats', { uid: 'chat-1', updated: 1800, deleted: true });
const s10 = chat({ title: 'Bike again', created: 1900, updated: 1900, turns: [turn('t4', { created: 1900, updated: 1900, answer: 'Yes', status: 'done' })] });
const states = [s1, s2, s3, s4, s5, s6, s7, s8, s8b, s9, s10];

test('every pair of states is joined by events that replay to the later state', () => {
  for (const state of states) assert.equal(canonical(applyChatEvents(null, chatEvents(null, state))), canonical(state));
  for (let index = 1; index < states.length; index++) {
    const before = states[index - 1], after = states[index];
    assert.equal(canonical(applyChatEvents(before, chatEvents(before, after))), canonical(after), `states ${index - 1} -> ${index}`);
  }
  for (const state of states) assert.deepEqual(chatEvents(state, state), []);
});

test('chatEvents is empty for equal chats and names only what changed', () => {
  const before = chat({ turns: [turn('t1', { created: 1000, error: 'Old failure' }), turn('t2', { created: 1100, answer: 'old', status: 'done' })] });
  assert.deepEqual(chatEvents(before, structuredClone(before)), []);

  const answered = structuredClone(before);
  answered.turns[1].answer = '900 euros';
  assert.deepEqual(chatEvents(before, answered), [{ kind: 'turn.set', uid: 't2', fields: { answer: '900 euros' } }]);

  const removed = structuredClone(before);
  delete removed.turns[0].error;
  assert.deepEqual(chatEvents(before, removed), [{ kind: 'turn.set', uid: 't1', fields: {}, unset: ['error'] }]);

  const configured = structuredClone(before);
  configured.config = config({ maxTokens: 4096 });
  assert.deepEqual(chatEvents(before, configured), [{ kind: 'chat.set', fields: { config: configured.config } }]);
});

test('applyChatEvents copies the chat, its turns and every turn it changes; frozen inputs stay untouched', () => {
  const before = freeze(structuredClone(states[6])), after = freeze(structuredClone(states[8]));
  const beforeText = canonical(before), afterText = canonical(after);
  const events = freeze(chatEvents(before, after));
  const result = applyChatEvents(before, events);
  assert.equal(canonical(result), afterText);
  assert.equal(canonical(before), beforeText);
  assert.equal(canonical(after), afterText);
  assert.notEqual(result, before);
  assert.notEqual(result.turns, before.turns);
  for (const turn of result.turns) assert.ok(before.turns.every(old => old !== turn));
});

test('appending numbers each chat from one, in its own transaction, and reading follows those numbers', async () => {
  const alice = await account(), bob = await account();
  const events = index => ({ kind: 'chat.set', fields: { title: 'title ' + index } });
  const first = await append(alice, 'a', [events(1), events(2), events(3)], 1000);
  assert.deepEqual(first.map(event => event.seq), [1, 2, 3]);
  const second = await append(alice, 'a', [events(4), events(5)], 2000);
  assert.deepEqual(second.map(event => event.seq), [4, 5]);
  assert.deepEqual((await append(alice, 'b', [events(1)])).map(event => event.seq), [1]);
  assert.deepEqual((await append(bob, 'a', [events(1), events(2)])).map(event => event.seq), [1, 2]);
  assert.deepEqual(await append(alice, 'a', []), []);

  const later = await readChatEvents(alice, 'a', 2);
  assert.deepEqual(later.events.map(event => event.seq), [3, 4, 5]);
  assert.equal(later.head, 5);
  assert.equal(later.gap, false);
  assert.equal(later.events[0].at, 1000);
  assert.equal(later.events[2].at, 2000);

  const page = await readChatEvents(alice, 'a', 0, 2);
  assert.deepEqual(page.events.map(event => event.seq), [1, 2]);
  assert.equal(page.head, 5);
  assert.equal(page.gap, false);
  assert.deepEqual(await readChatEvents(alice, 'a', 5), { events: [], head: 5, gap: false });
  assert.deepEqual(await readChatEvents(alice, 'empty'), { events: [], head: 0, gap: false });
});

test('replaying the whole log from nothing gives the last state', async () => {
  const user = await account();
  for (let index = 1; index < states.length; index++) await append(user, 'replay', chatEvents(states[index - 1], states[index]));
  const { events, head, gap } = await readChatEvents(user, 'replay');
  assert.equal(head, events.length);
  assert.equal(gap, false);
  assert.equal(canonical(applyChatEvents(null, events)), canonical(states.at(-1)));
});

test('after a trim a reader behind it gets a gap; a reader at or after it does not', async () => {
  const user = await account();
  await append(user, 'trim', Array.from({ length: 10 }, (_, index) => ({ kind: 'chat.set', fields: { title: 'title ' + index } })));
  assert.equal(await trimChatEvents(user, 'trim', 3), 7);
  const behind = await readChatEvents(user, 'trim', 0);
  assert.deepEqual(behind.events.map(event => event.seq), [8, 9, 10]);
  assert.equal(behind.head, 10);
  assert.equal(behind.gap, true);
  for (const after of [7, 8, 10]) {
    const reader = await readChatEvents(user, 'trim', after);
    assert.equal(reader.gap, false, `after ${after}`);
    assert.equal(reader.head, 10);
  }
  assert.equal(await trimChatEvents(user, 'trim', 3), 0);
});

test('invalid positions and limits are refused', async () => {
  const user = await account();
  for (const after of [-1, 1.5, NaN, Infinity, '1']) await assert.rejects(async () => readChatEvents(user, 'a', after), error => error.status === 400);
  for (const limit of [-1, 1.5, NaN, Infinity, '1']) await assert.rejects(async () => readChatEvents(user, 'a', 0, limit), error => error.status === 400);
});
