import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The tab's side of a chat's numbered log: a clean copy takes only the changes after its number, and every other copy
// is left to the pull. A real libSQL file database and an in-memory localStorage; no provider is used.
class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i] ?? null; }
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k, v) { this.values.set(k, String(v)); }
  removeItem(k) { this.values.delete(k); }
}
globalThis.localStorage = new Memory();
localStorage.setItem('pocket:active-account', 'u1');
const dispatched = [];
globalThis.dispatchEvent = event => { dispatched.push(event.type); return true; };

const folder = mkdtempSync(join(tmpdir(), 'pocket-chat-follow-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { writeObject } = await import('../src/server/objects.js');
const { readChatEvents } = await import('../src/server/chat-log.js');
const { canonical, sanitizeObject } = await import('../src/shared/objects.js');
const { storage } = await import('../src/client/workspace-storage.js');
const { marker } = await import('../src/client/persistence-events.js');
const { applyChat, chatAt, followChat, noteChat } = await import('../src/client/chat-follow.js');
await ensureSchema();
const user = 'u1', now = Date.now();
await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [user, 'Fixture', 'u1@example.com', now, now] });
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const config = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
const chat = (uid, over = {}) => sanitizeObject('chats', { uid, title: 'Bike', created: 1000, updated: 1000, draft: '', config, context: [], turns: [], ...over });
const turn = (uid, over = {}) => ({ uid, text: 'How much is the bike?', answer: '', status: 'streaming', created: 1000, updated: 1000, context: [], ...over });
const storedChat = uid => JSON.parse(storage.getItem('pocket:pip-chat:' + uid));
const chatKey = uid => 'pocket:pip-chat:' + uid, seqKey = uid => 'pocket:chat-seq:' + uid;

/** Writes a chat and leaves the tab holding that whole copy, clean, at the write's number. */
async function start(uid, over = {}) {
  const written = await writeObject(user, 'chats', chat(uid, over));
  storage.setItem(chatKey(uid), JSON.stringify(written.value));
  storage.setItem('pocket:chat-ack:' + uid, '1');
  storage.removeItem(marker('chats', uid));
  noteChat(uid, written.seq, true);
  return written;
}

test('a clean chat at N applies the events after it, stores the server value and dispatches one sync', async () => {
  const uid = 'chat-apply';
  const first = await start(uid, { turns: [turn('t1')] });
  assert.equal(chatAt(uid), first.seq);
  const written = await writeObject(user, 'chats', { ...first.value, title: 'Bike and price', updated: 2000 });
  const { events, head } = await readChatEvents(user, uid, chatAt(uid));
  assert.ok(events.length > 0);
  const before = dispatched.filter(type => type === 'pocket-objects-synced').length;
  assert.equal(applyChat(uid, events, head), true);
  assert.equal(canonical(storedChat(uid)), canonical(written.value));
  assert.equal(chatAt(uid), head);
  assert.equal(written.seq, head);
  assert.equal(dispatched.filter(type => type === 'pocket-objects-synced').length, before + 1);
});

test('a chat that cannot prove its number is not changed', async () => {
  const uid = 'chat-refuse';
  const first = await start(uid);
  let value = first.value;
  for (const patch of [{ title: 'Next' }, { pinned: true }, { draft: 'Hello' }]) {
    const written = await writeObject(user, 'chats', { ...value, ...patch, updated: value.updated + 1000 });
    value = written.value;
  }
  const { events, head } = await readChatEvents(user, uid, first.seq);
  assert.equal(events.length, 3);
  const refused = (batch, at) => {
    const local = storage.getItem(chatKey(uid)), number = storage.getItem(seqKey(uid));
    assert.equal(applyChat(uid, batch, at), false);
    assert.equal(storage.getItem(chatKey(uid)), local);
    assert.equal(storage.getItem(seqKey(uid)), number);
  };

  // No number for the copy.
  storage.removeItem(seqKey(uid));
  refused(events, head);
  noteChat(uid, first.seq, true);

  // A local edit is waiting.
  storage.setItem(marker('chats', uid), '1');
  refused(events, head);
  storage.removeItem(marker('chats', uid));

  // The first event is N+2, not N+1.
  refused(events.map(event => ({ ...event, seq: event.seq + 1 })), head + 1);

  // A number was skipped.
  refused(events.filter((_, index) => index !== 1), head);

  // The last event is not the head.
  refused(events.slice(0, -1), head);

  // There is no chat stored.
  const local = storage.getItem(chatKey(uid));
  storage.removeItem(chatKey(uid));
  refused(events, head);
  storage.setItem(chatKey(uid), local);
});

test('events the tab already has are skipped, and an entirely old batch writes nothing', async () => {
  const uid = 'chat-old';
  const first = await start(uid);
  const written = await writeObject(user, 'chats', { ...first.value, title: 'Later', updated: 2000 });
  const { events, head } = await readChatEvents(user, uid, first.seq);
  const stale = { kind: 'chat.set', fields: { title: 'Stale' }, seq: first.seq };
  const before = dispatched.filter(type => type === 'pocket-objects-synced').length;
  assert.equal(applyChat(uid, [stale, ...events], head), true);
  assert.equal(canonical(storedChat(uid)), canonical(written.value));
  assert.equal(chatAt(uid), head);

  const local = storage.getItem(chatKey(uid)), number = storage.getItem(seqKey(uid));
  assert.equal(applyChat(uid, [stale], first.seq), true);
  assert.equal(storage.getItem(chatKey(uid)), local);
  assert.equal(storage.getItem(seqKey(uid)), number);
  assert.equal(dispatched.filter(type => type === 'pocket-objects-synced').length, before + 1);
});

test('followChat applies a fitting change, asks when none came, and gives up on a gap or an error', async () => {
  const uid = 'chat-follow';
  const first = await start(uid);
  const second = await writeObject(user, 'chats', { ...first.value, title: 'Second', updated: 2000 });
  const batch = await readChatEvents(user, uid, first.seq);
  let asked = 0;
  const ask = async () => { asked++; return batch; };
  assert.equal(await followChat({ collection: 'chats', uid, seq: batch.head, events: batch.events }, ask), true);
  assert.equal(asked, 0);
  assert.equal(canonical(storedChat(uid)), canonical(second.value));

  const third = await writeObject(user, 'chats', { ...second.value, title: 'Third', updated: 3000 });
  const missed = await readChatEvents(user, uid, batch.head);
  let after = null;
  const askMissed = async (chat, from) => { asked++; after = [chat, from]; return missed; };
  assert.equal(await followChat({ collection: 'chats', uid, seq: missed.head }, askMissed), true);
  assert.equal(asked, 1);
  assert.deepEqual(after, [uid, batch.head]);
  assert.equal(canonical(storedChat(uid)), canonical(third.value));
  assert.equal(chatAt(uid), third.seq);

  const fourth = await writeObject(user, 'chats', { ...third.value, title: 'Fourth', updated: 4000 });
  asked = 0;
  assert.equal(await followChat({ collection: 'chats', uid, seq: fourth.seq }, async () => ({ events: [], head: fourth.seq, gap: true })), false);
  assert.equal(chatAt(uid), third.seq);
  assert.equal(await followChat({ collection: 'chats', uid, seq: fourth.seq }, async () => { throw new Error('offline'); }), false);
  assert.equal(chatAt(uid), third.seq);

  assert.equal(await followChat({ collection: 'zines', uid: 'zine-1', seq: 1 }, async () => { asked++; return { events: [], head: 0 }; }), false);
  assert.equal(asked, 0);
});

test('two follows of one chat run in order, so the second asks from the first one’s number', async () => {
  const uid = 'chat-chain';
  const first = await start(uid);
  const second = await writeObject(user, 'chats', { ...first.value, title: 'Second', updated: 2000 });
  const batch = await readChatEvents(user, uid, first.seq);
  const third = await writeObject(user, 'chats', { ...second.value, title: 'Third', updated: 3000 });
  const asked = [];
  const ask = async (chat, after) => { asked.push(after); return readChatEvents(user, chat, after); };
  const a = followChat({ collection: 'chats', uid, seq: second.seq, events: batch.events }, ask);
  const b = followChat({ collection: 'chats', uid, seq: third.seq }, ask);
  assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.deepEqual(asked, [second.seq]);
  assert.equal(chatAt(uid), third.seq);
  assert.equal(canonical(storedChat(uid)), canonical(third.value));
});

test('noteChat stores a matching whole chat’s number, including 0, and removes it otherwise', () => {
  const uid = 'chat-note';
  storage.setItem(chatKey(uid), JSON.stringify(chat(uid)));
  storage.setItem('pocket:chat-ack:' + uid, '1');
  storage.removeItem(marker('chats', uid));
  noteChat(uid, 0, true);
  assert.equal(chatAt(uid), 0);
  noteChat(uid, 12, true);
  assert.equal(chatAt(uid), 12);
  noteChat(uid, 13, false);
  assert.equal(chatAt(uid), null);
  assert.equal(storage.getItem(seqKey(uid)), null);
  noteChat(uid, 1.5, true);
  assert.equal(chatAt(uid), null);
});
