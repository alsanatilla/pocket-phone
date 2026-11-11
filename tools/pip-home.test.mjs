import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleMessage, response } from './pip-provider-fixtures.mjs';

// The rules of the home chat, and what a server reply in one sees and stores. A real libSQL file database; the
// provider is the only fake.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-home-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token';
process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { saveBackground } = await import('../src/server/pip-background.js');
const { writeObject } = await import('../src/server/objects.js');
const runs = await import('../src/server/pip-runs.js');
const { sanitizeObject, validObject, canonical } = await import('../src/shared/objects.js');
const { chatEvents, applyChatEvents } = await import('../src/shared/chat-log.js');
const { HOME_TURNS, HOME_BYTES, homeSegments, currentHome, homeFull, homeTail } = await import('../src/shared/pip-home.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
const SETTINGS = { ...CONFIG, grants: ['notes', 'tasks'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
let users = 0, clock = 1000;
async function account(settings = SETTINGS) {
  const id = 'home-user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await saveBackground(id, settings, 'fixture-key-123456');
  return id;
}
const turn = (uid, text, answer, status = 'done', created = ++clock) => ({ uid, text, answer, status, created, updated: created, context: [] });
function chat(uid, over = {}) {
  const now = ++clock;
  return { uid, title: 'Pip', created: now, updated: now, draft: '', context: [], config: CONFIG, turns: [], ...over };
}
const header = (uid, title = 'Pip') => ({ uid, title, created: Date.now(), config: CONFIG });
const chatOf = async (userId, uid) => JSON.parse(String((await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0].payload));
const provider = (sent, ...replies) => async (url, options) => {
  sent.push(JSON.parse(options.body));
  assert.ok(replies.length, 'The fixture expected no further request.');
  return response(replies.shift());
};
/** Runs `work` while counting the queries that read home segments through the client the modules use. */
async function countHomeReads(work) {
  const client = database(), own = Object.hasOwn(client, 'execute'), original = client.execute;
  let count = 0;
  client.execute = function (statement) {
    const text = typeof statement === 'string' ? statement : String(statement?.sql || '');
    if (text.includes('"home":true')) count++;
    return original.call(this, statement);
  };
  let result;
  try { result = await work(); } finally { if (own) client.execute = original; else delete client.execute; }
  return { count, result };
}
const plain = messages => messages.filter(message => message.role !== 'system');

test('homeSegments orders the home chats oldest first, leaves out deleted and ordinary chats, and currentHome is the last', () => {
  const chats = [
    { uid: 'new', created: 300, home: true, turns: [] },
    { uid: 'ordinary', created: 250, turns: [] },
    { uid: 'old', created: 100, home: true, turns: [] },
    { uid: 'middle', created: 200, home: true, turns: [] },
    { uid: 'deleted', created: 150, home: true, deleted: true, turns: [] },
  ];
  assert.deepEqual(homeSegments(chats).map(chat => chat.uid), ['old', 'middle', 'new']);
  assert.equal(currentHome(chats).uid, 'new');
  assert.equal(currentHome([{ uid: 'ordinary', created: 1, turns: [] }]), null);
  assert.deepEqual(homeSegments([
    { uid: 'b', created: 1, home: true, turns: [] },
    { uid: 'a', created: 1, home: true, turns: [] },
  ]).map(chat => chat.uid), ['a', 'b']);
});

test('homeFull counts turns and size, and leaves a chat whose last turn still streams open', () => {
  const turns = count => Array.from({ length: count }, (_, index) => ({ uid: 't' + index, text: 'q', answer: 'a', status: 'done', created: index }));
  assert.equal(homeFull({ uid: 'short', turns: turns(59) }), false);
  assert.equal(homeFull({ uid: 'full', turns: turns(HOME_TURNS) }), true);
  assert.equal(homeFull({ uid: 'huge', turns: [{ uid: 't', text: 'q', answer: 'x'.repeat(HOME_BYTES), status: 'done', created: 1 }] }), true);
  const streaming = turns(HOME_TURNS); streaming[streaming.length - 1] = { ...streaming[streaming.length - 1], status: 'streaming' };
  assert.equal(homeFull({ uid: 'streaming', turns: streaming }), false);
});

test('homeTail takes the last finished turns of the segment before, and none when nothing is needed', () => {
  const done = (uid, created = ++clock) => ({ uid, status: 'done', created });
  const previous = { uid: 'second', created: 200, home: true, turns: [done('d1'), done('d2'), done('d3'), done('d4'), done('d5'), done('d6'), done('d7'), done('d8'), { uid: 'f1', status: 'failed', created: 900 }, { uid: 's1', status: 'streaming', created: 901 }] };
  const first = { uid: 'first', created: 100, home: true, turns: [done('first-1')] }, current = { uid: 'third', created: 300, home: true, turns: [] };
  const segments = [first, previous, current];
  assert.deepEqual(homeTail(segments, current).map(turn => turn.uid), ['d3', 'd4', 'd5', 'd6', 'd7', 'd8']);
  assert.deepEqual(homeTail(segments, first), []);
  assert.deepEqual(homeTail(segments, { uid: 'ordinary', created: 400, turns: [] }), []);
  const shorter = [{ uid: 'before', created: 1, home: true, turns: [done('p1'), done('p2')] }, { uid: 'after', created: 2, home: true, turns: [] }];
  assert.deepEqual(homeTail(shorter, shorter[1]).map(turn => turn.uid), ['p1', 'p2']);
  const own = [...segments, { uid: 'fourth', created: 400, home: true, turns: Array.from({ length: 6 }, (_, index) => done('own' + index)) }];
  assert.deepEqual(homeTail(own, own[3]), []);
});

test('the home mark is kept and valid, survives the log, and a tombstone stays a tombstone', async () => {
  const userId = await account();
  const value = chat('chat-home', { uid: 'chat-home', title: 'pip', titled: true, home: true, created: 1000, updated: 1000, turns: [turn('t1', 'Hello', 'Hi.')] });
  assert.equal(sanitizeObject('chats', value).home, true);
  assert.equal(validObject('chats', value), true);
  assert.equal(validObject('chats', { ...value, home: false }), false);
  assert.equal(validObject('chats', { ...value, home: 'yes' }), false);
  assert.equal(validObject('chats', { ...value, home: undefined }), true);
  assert.deepEqual(sanitizeObject('chats', { uid: 'chat-home', updated: 2000, deleted: true, home: true }), { uid: 'chat-home', updated: 2000, deleted: true });
  const replayed = applyChatEvents(null, chatEvents(null, value));
  assert.equal(canonical(replayed), canonical(value));
  await writeObject(userId, 'chats', value);
  assert.equal((await chatOf(userId, 'chat-home')).home, true);
});

test('a server reply in a new home segment reads the tail of the previous one before its own question', async () => {
  const userId = await account();
  await writeObject(userId, 'chats', chat('home-before', { created: 1000, updated: 1000, home: true, turns: [turn('bruno', 'My dog is called Bruno.', 'Noted.', 'done', 1000)] }));
  await writeObject(userId, 'chats', chat('home-now', { created: 2000, updated: 2000, home: true, turns: [] }));

  const sent = [];
  const { count, result: submitted } = await countHomeReads(() => runs.submitRun(userId, { requestId: 'req-home-tail', chat: header('home-now'), text: 'What is my dog called?', device: 'browser-1' },
    { fetcher: provider(sent, compatibleMessage({ text: 'Bruno.' })) }));
  assert.equal(submitted.run.status, 'done', submitted.run.turn.error);
  assert.equal(count, 1);
  const messages = plain(sent[0].messages);
  assert.deepEqual(messages.slice(0, 2), [{ role: 'user', content: 'My dog is called Bruno.' }, { role: 'assistant', content: 'Noted.' }]);
  assert.equal(messages.length, 3);
  assert.equal(messages[2].role, 'user');
  assert.match(String(messages[2].content), /What is my dog called\?/);

  const stored = await chatOf(userId, 'home-now');
  assert.equal(stored.home, true);
  assert.equal(stored.turns.length, 1);
  assert.equal(stored.turns[0].uid, submitted.run.turn.uid);
  assert.equal(stored.turns[0].text, 'What is my dog called?');
  assert.equal(stored.turns.some(turn => turn.uid === 'bruno'), false);
});

test('a server reply in an ordinary chat reads no home segments and its request keeps only its own turns', async () => {
  const userId = await account();
  await writeObject(userId, 'chats', chat('ordinary', { created: 3000, updated: 3000, turns: [turn('o1', 'My dog is called Bruno.', 'Noted.'), turn('o2', 'What is my dog called?', 'Bruno.')] }));
  await writeObject(userId, 'chats', chat('home-other', { created: 4000, updated: 4000, home: true, turns: [turn('h1', 'Home only', 'Home only answer')] }));

  const sent = [];
  const { count, result: submitted } = await countHomeReads(() => runs.submitRun(userId, { requestId: 'req-ordinary', chat: header('ordinary'), text: 'And again?' },
    { fetcher: provider(sent, compatibleMessage({ text: 'Bruno.' })) }));
  assert.equal(submitted.run.status, 'done', submitted.run.turn.error);
  assert.equal(count, 0);
  assert.deepEqual(plain(sent[0].messages), [
    { role: 'user', content: 'My dog is called Bruno.' }, { role: 'assistant', content: 'Noted.' },
    { role: 'user', content: 'What is my dog called?' }, { role: 'assistant', content: 'Bruno.' },
    { role: 'user', content: 'And again?' },
  ]);
});

test('a new chat takes the home mark from its header only when it is exactly true', async () => {
  const userId = await account();
  await runs.submitRun(userId, { requestId: 'req-mark-home', chat: { ...header('chat-marked'), home: true }, text: 'Hello' },
    { fetcher: provider([], compatibleMessage({ text: 'Hi.' })) });
  assert.equal((await chatOf(userId, 'chat-marked')).home, true);

  await runs.submitRun(userId, { requestId: 'req-mark-string', chat: { ...header('chat-string'), home: 'true' }, text: 'Hello' },
    { fetcher: provider([], compatibleMessage({ text: 'Hi.' })) });
  assert.equal('home' in await chatOf(userId, 'chat-string'), false);
});
