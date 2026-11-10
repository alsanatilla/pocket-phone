import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// What writeObject records in a chat's log, and what its objects event carries. A real libSQL file database; no Turso
// account or provider key is used.
const folder = mkdtempSync(join(tmpdir(), 'pocket-chat-writes-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { writeObject, readObjects } = await import('../src/server/objects.js');
const { appendChatEvents, readChatEvents } = await import('../src/server/chat-log.js');
const { applyChatEvents } = await import('../src/shared/chat-log.js');
const { canonical, sanitizeObject } = await import('../src/shared/objects.js');
const { subscribe } = await import('../src/server/pocket-events.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

let users = 0;
async function account() {
  const id = 'chat-writes-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  return id;
}
const config = (over = {}) => ({ provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false, ...over });
const context = [{ kind: 'note', uid: 'n1', title: 'Bike', text: 'The red bike costs 900 euros.', href: '/notes/n1' }];
const chat = over => sanitizeObject('chats', { uid: 'chat-1', title: 'Bike', created: 1000, updated: 1000, draft: '', config: config(), context, turns: [], ...over });
const turn = (uid, over = {}) => ({ uid, text: 'How much is the bike?', answer: '', status: 'streaming', created: 1000, updated: 1000, context: [], ...over });
async function storedOf(userId, uid) {
  const rows = await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] });
  return rows.rows[0] ? JSON.parse(String(rows.rows[0].payload)) : null;
}
const replayed = (chat, events) => applyChatEvents(chat, events);

test('a new chat is logged whole, and the write returns the log head', async () => {
  const user = await account(), value = chat({ turns: [turn('t1')] });
  const written = await writeObject(user, 'chats', value);
  const stored = await storedOf(user, value.uid);
  const { events, head, gap } = await readChatEvents(user, value.uid, 0);
  assert.equal(written.seq, head);
  assert.equal(gap, false);
  assert.equal(head, events.length);
  assert.equal(canonical(replayed(null, events)), canonical(stored));
});

test('each later write logs what changed from the previous head and from nothing', async () => {
  const user = await account(), uid = 'chat-1';
  let written = await writeObject(user, 'chats', chat({ turns: [turn('t1')] }));
  let stored = await storedOf(user, uid), head = written.seq;
  const write = async (value, options) => {
    const before = stored, previousHead = head;
    written = await writeObject(user, 'chats', value, options);
    stored = await storedOf(user, uid);
    const whole = await readChatEvents(user, uid, 0);
    assert.equal(canonical(replayed(null, whole.events)), canonical(stored));
    const later = await readChatEvents(user, uid, previousHead);
    assert.equal(canonical(replayed(before, later.events)), canonical(stored));
    assert.equal(written.seq, whole.head);
    head = written.seq;
  };
  // A turn added by a background reply (writeTurn's shape): only the new turn is in the write.
  await write(chat({ updated: 2000, turns: [turn('t2', { created: 1100, updated: 2000, text: 'And the blue one?' })] }), { appendTurns: true });
  await write({ ...stored, updated: 3000, turns: stored.turns.map(item => item.uid === 't2' ? { ...item, answer: '900 euros', status: 'done', updated: 3000 } : item) });
  await write({ ...stored, title: 'Bike and price', updated: 4000 });
  await write({ ...stored, updated: 5000, turns: stored.turns.map(item => item.uid === 't1' ? { ...item, updated: 5000, answer: 'Here is the card.\n\n```pocket\n{"uid":"card-1","root":"card-1","elements":[]}\n```' } : item) });
  await write({ uid, updated: 6000, deleted: true });
  assert.deepEqual(stored, { uid, updated: 6000, deleted: true });
});

test('a write that changes nothing logs nothing', async () => {
  const user = await account(), value = chat();
  await writeObject(user, 'chats', value);
  // mergeObject stamps a chat's missing draftUpdated on its first merge; once settled, the same object changes nothing.
  const settled = await writeObject(user, 'chats', value);
  const before = await readChatEvents(user, value.uid);
  const again = await writeObject(user, 'chats', value);
  const after = await readChatEvents(user, value.uid);
  assert.equal(again.seq, before.head);
  assert.equal(after.head, settled.seq);
  assert.deepEqual(after, before);
});

test('a chat written before the log existed starts it with the whole chat', async () => {
  const user = await account(), uid = 'chat-old';
  const old = chat({ uid, title: 'Old chat', turns: [turn('t1', { answer: 'Before the log', status: 'done' })] });
  const change = await execute({ sql: 'INSERT INTO pocket_object_changes (user_id, collection, uid) VALUES (?, ?, ?)', args: [user, 'chats', uid] });
  await execute({ sql: 'INSERT INTO pocket_objects (user_id, collection, uid, payload, revision) VALUES (?, ?, ?, ?, ?)', args: [user, 'chats', uid, JSON.stringify(old), Number(change.lastInsertRowid)] });
  assert.deepEqual(await readChatEvents(user, uid), { events: [], head: 0, gap: false });

  const written = await writeObject(user, 'chats', { ...old, title: 'Old chat, renamed', updated: 2000 });
  const stored = await storedOf(user, uid);
  const { events, head } = await readChatEvents(user, uid, 0);
  assert.equal(written.seq, head);
  assert.equal(events[0]?.kind, 'chat.set');
  assert.equal(canonical(replayed(null, events)), canonical(stored));
});

test('a small write publishes its number and events; a turn too large to fit publishes only its number', async () => {
  const user = await account(), value = chat();
  await writeObject(user, 'chats', value);
  const heard = [], stop = subscribe(user, event => { if (event.type === 'objects' && event.collection === 'chats') heard.push(event); });
  try {
    const before = await storedOf(user, value.uid);
    const small = await writeObject(user, 'chats', { ...before, title: 'Small change', updated: 2000 });
    assert.equal(heard.length, 1);
    assert.equal(heard[0].seq, small.seq);
    assert.ok(Array.isArray(heard[0].events) && heard[0].events.length > 0);
    assert.equal(canonical(replayed(before, heard[0].events)), canonical(await storedOf(user, value.uid)));

    heard.length = 0;
    const previous = await storedOf(user, value.uid);
    const big = turn('big', { created: 3000, updated: 3000, answer: 'x'.repeat(40_000), status: 'done' });
    const large = await writeObject(user, 'chats', { ...previous, updated: 3000, turns: [...previous.turns, big] });
    assert.equal(heard.length, 1);
    assert.equal(heard[0].seq, large.seq);
    assert.equal('events' in heard[0], false);
  } finally { stop(); }
});

test('a write that reaches a multiple of 200 trims the log to its newest 2,000 events', async () => {
  const user = await account(), uid = 'chat-trim';
  await writeObject(user, 'chats', chat({ uid }));
  const tx = await database().transaction('write');
  try {
    await appendChatEvents(tx, user, uid, Array.from({ length: 2198 }, (_, index) => ({ kind: 'chat.set', fields: { title: 'Earlier ' + index } })));
    await tx.commit();
  } catch (error) { await tx.rollback().catch(() => {}); throw error; } finally { tx.close(); }
  assert.equal((await readChatEvents(user, uid, 0, 1)).head, 2199);

  const written = await writeObject(user, 'chats', { ...await storedOf(user, uid), title: 'Trimmed', updated: 2000 });
  assert.equal(written.seq, 2200);
  const bounds = await execute({ sql: 'SELECT COUNT(*) AS count, MIN(seq) AS lowest FROM pocket_chat_events WHERE user_id = ? AND chat_uid = ?', args: [user, uid] });
  assert.equal(Number(bounds.rows[0].count), 2000);
  assert.equal(Number(bounds.rows[0].lowest), 201);
  const behind = await readChatEvents(user, uid, 0);
  assert.equal(behind.head, 2200);
  assert.equal(behind.gap, true);
});

test('another account reading the same chat id has no log for it', async () => {
  const owner = await account(), other = await account(), value = chat();
  await writeObject(owner, 'chats', value);
  assert.deepEqual(await readChatEvents(other, value.uid), { events: [], head: 0, gap: false });
});

test('a zine write logs nothing and its event has no chat fields', async () => {
  const user = await account(), heard = [];
  const stop = subscribe(user, event => heard.push(event));
  try {
    const written = await writeObject(user, 'zines', { id: 'zine-1', updated: 1000, deleted: true });
    assert.equal('seq' in written, false);
    assert.equal(heard.length, 1);
    assert.deepEqual(Object.keys(heard[0]).sort(), ['collection', 'revision', 'type', 'uid']);
    assert.equal(heard[0].uid, 'zine-1');
  } finally { stop(); }
});

test('readObjects gives every chat its log head, 0 without a log, and zines no heads', async () => {
  const user = await account();
  const logged = await writeObject(user, 'chats', chat({ uid: 'chat-logged' }));
  const old = chat({ uid: 'chat-no-log' });
  const change = await execute({ sql: 'INSERT INTO pocket_object_changes (user_id, collection, uid) VALUES (?, ?, ?)', args: [user, 'chats', old.uid] });
  await execute({ sql: 'INSERT INTO pocket_objects (user_id, collection, uid, payload, revision) VALUES (?, ?, ?, ?, ?)', args: [user, 'chats', old.uid, JSON.stringify(old), Number(change.lastInsertRowid)] });
  await writeObject(user, 'zines', { id: 'zine-1', updated: 1000, deleted: true });

  const chats = await readObjects(user, 'chats');
  assert.equal(chats.seqs['chat-logged'], logged.seq);
  assert.equal(chats.seqs['chat-no-log'], 0);
  assert.equal(canonical(chats.items.find(item => item.uid === 'chat-logged')), canonical(logged.value));
  const zines = await readObjects(user, 'zines');
  assert.equal('seqs' in zines, false);
  assert.deepEqual(zines.items.map(item => item.id), ['zine-1']);
});
