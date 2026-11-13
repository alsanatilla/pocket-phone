import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anthropicMessage, compatibleMessage, response } from './pip-provider-fixtures.mjs';
import { browser, pushService } from './push-fixture.mjs';

// Pip's background jobs: schedules beyond "a time on chosen days", a job's own notes between runs, quiet delivery
// and failure alerts once per streak. A real libSQL file database; no Turso account or provider key is used.
const folder = mkdtempSync(join(tmpdir(), 'pocket-jobs-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments } = await import('../src/server/workspace.js');
const background = await import('../src/server/pip-background.js');
const notices = await import('../src/server/pip-notify.js');
const { toolNames } = await import('../src/client/pip-tools.js');
const keys = await import('../src/server/pip-keys.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

let users = 0;
async function account() {
  const id = 'jobs-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes: [{ uid: 'n1', text: '# Bike\n\nThe red bike costs 900 euros.', pinned: false, created: now, updated: now, deleted: false }] } });
  await background.saveBackground(id, settings, 'fixture-key-123456');
  return id;
}
const settings = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
const at = iso => Date.parse(iso);
const iso = value => new Date(value).toISOString();

test('interval jobs run inside their days and active hours, overnight windows included; one-off jobs run once', () => {
  const { nextRun } = background, tz = 'Europe/Berlin';
  // Monday 2026-11-09 10:00 Berlin (09:00Z), every 30 minutes, 08:00–22:00.
  const day = { every: 30, days: [0, 1, 2, 3, 4, 5, 6], activeHours: { start: '08:00', end: '22:00' } };
  assert.equal(iso(nextRun(day, tz, at('2026-11-09T09:00:00Z'))), '2026-11-09T09:30:00.000Z');
  // 21:50 → the next run would be 22:20, outside; it waits for 08:00 the next morning.
  assert.equal(iso(nextRun(day, tz, at('2026-11-09T20:50:00Z'))), '2026-11-10T07:00:00.000Z');
  // Weekdays only: Friday evening jumps to Monday morning.
  assert.equal(iso(nextRun({ ...day, days: [1, 2, 3, 4, 5] }, tz, at('2026-11-13T20:50:00Z'))), '2026-11-16T07:00:00.000Z');
  // Overnight window 22:00–06:00: at 12:00 it waits until 22:00.
  assert.equal(iso(nextRun({ every: 60, days: [0, 1, 2, 3, 4, 5, 6], activeHours: { start: '22:00', end: '06:00' } }, tz, at('2026-11-09T11:00:00Z'))), '2026-11-09T21:00:00.000Z');
  const once = at('2026-11-12T17:00:00Z');
  assert.equal(nextRun({ at: once }, tz, at('2026-11-09T09:00:00Z')), once);
  assert.equal(nextRun({ at: once }, tz, once), Number.MAX_SAFE_INTEGER, 'a one-off job does not come back');
});

test('jobs are validated: interval bounds, a moment within the year, real active hours; training stays daily', () => {
  const routine = background.backgroundRoutine;
  assert.throws(() => routine({ kind: 'watch', prompt: 'x', every: 5 }), /every 15 minutes/);
  assert.throws(() => routine({ kind: 'prompt', title: 'Past', prompt: 'x', at: Date.now() - 3600000 }), /within the next year/);
  assert.throws(() => routine({ kind: 'watch', prompt: 'x', every: 60, activeHours: { start: '09:00', end: '09:00' } }), /active hours/);
  const watch = routine({ kind: 'watch', prompt: 'New bike prices', every: 60, activeHours: { start: '08:00', end: '24:00' }, delivery: 'quiet' });
  assert.deepEqual([watch.every, watch.activeHours, watch.delivery, watch.days.length], [60, { start: '08:00', end: '00:00' }, 'quiet', 7]);
  const reminder = routine({ kind: 'prompt', title: 'Call Sam', prompt: 'Remind me to call Sam', at: Date.now() + 3600000 });
  assert.equal(reminder.delivery, 'notify'); assert.ok(reminder.at > Date.now());
  const training = routine({ kind: 'training', time: '07:00', days: [1], trainingDays: [1, 3], every: 30 });
  assert.equal(training.every, undefined, 'the training planner keeps its daily review');
});

test('a job keeps notes between runs: it can write them, the next run reads them, a conversation never sees the tool', async () => {
  const userId = await account(), sent = [];
  const { routines } = await background.saveRoutine(userId, { kind: 'watch', title: 'Bike watch', prompt: 'Tell me when the red bike gets cheaper.', time: '08:00', days: [1, 2, 3, 4, 5] });
  const id = routines[0].id;
  let replies = [
    compatibleMessage({ calls: [{ name: 'update_scratch', input: { notes: 'Reported: red bike 900 euros.' }, id: 'call_notes' }] }),
    compatibleMessage({ text: 'The red bike costs 900 euros.' }),
  ];
  const fetcher = async (url, options) => { sent.push(JSON.parse(options.body)); return response(replies.shift()); };
  const first = await background.runClaimed(userId, id, { force: true, fetcher });
  assert.equal(first.status, 'done');
  assert.ok(sent[0].tools.some(tool => tool.function.name === 'update_scratch'));
  assert.match(sent[0].messages[0].content, /none yet, this is the first run/);
  assert.equal(await background.readScratch(userId, id), 'Reported: red bike 900 euros.');
  assert.equal((await background.backgroundState(userId)).routines[0].scratch, 'Reported: red bike 900 euros.');

  sent.length = 0; replies = [compatibleMessage({ text: 'SKIP' })];
  await execute({ sql: "UPDATE pocket_pip_routines SET last_run = 0 WHERE user_id = ?", args: [userId] });
  await background.runClaimed(userId, id, { force: true, fetcher });
  assert.match(sent[0].messages[0].content, /<<<\nReported: red bike 900 euros\.\n>>>/);

  // Saving the routine again keeps its notes; clearing them empties them.
  await background.saveRoutine(userId, { ...routines[0], title: 'Bike price watch' });
  assert.equal(await background.readScratch(userId, id), 'Reported: red bike 900 euros.');
  await background.clearScratch(userId, id);
  assert.equal(await background.readScratch(userId, id), '');

  const chatValue = { provider: 'compatible', baseUrl: 'https://model.example/v1', model: 'm', grants: ['notes'] };
  assert.ok(!toolNames(chatValue).includes('update_scratch'), 'a conversation never gets the job notes tool');
  assert.ok(toolNames({ ...chatValue, backgroundJob: true }).includes('update_scratch'));
});

test('a quiet job does not push; failures push once per streak, on the second in a row', async () => {
  const userId = await account(), phone = browser();
  await notices.subscribe(userId, phone.subscription);
  const quiet = (await background.saveRoutine(userId, { kind: 'prompt', title: 'Quiet', prompt: 'Summarise my notes.', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], delivery: 'quiet' })).routines[0];
  const service = pushService();
  const due = async (id, fetcher) => { await execute({ sql: 'UPDATE pocket_pip_routines SET next_run = 1 WHERE user_id = ? AND id = ?', args: [userId, id] }); await background.runPipJob({ fetcher }); };
  const pushes = () => service.pushed.filter(item => item.endpoint === phone.subscription.endpoint).length;
  try {
    await due(quiet.id, async () => response(compatibleMessage({ text: 'Your notes are about a bike.' })));
    assert.equal(pushes(), 0, 'quiet delivery writes to the chat only');

    const loud = (await background.saveRoutine(userId, { kind: 'prompt', title: 'Loud', prompt: 'Summarise my notes.', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6] })).routines.find(item => item.title === 'Loud');
    const broken = async () => new Response('down', { status: 500 });
    await due(loud.id, broken); assert.equal(pushes(), 0, 'one failure is not worth a buzz');
    await due(loud.id, broken); assert.equal(pushes(), 1, 'the second failure in a row alerts');
    await due(loud.id, broken); assert.equal(pushes(), 1, 'the same streak does not alert again');
    await due(loud.id, async () => response(compatibleMessage({ text: 'Back to normal.' }))); assert.equal(pushes(), 2, 'a success notifies as usual');
  } finally { service.restore(); }
});

test('jobs can use the key the account already keeps for Pip, when asked to, and only then', async () => {
  const id = 'jobs-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  const anthropic = { provider: 'anthropic', model: 'claude-haiku-5-5', baseUrl: 'https://api.anthropic.com/v1', maxTokens: 2048, grants: ['notes'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
  await keys.saveKey(id, { provider: 'anthropic', baseUrl: anthropic.baseUrl, key: 'sk-ant-fixture-account-key-0123456789' });

  let state = await background.saveBackground(id, anthropic);
  assert.equal(state.hasKey, false, 'without asking, a job does not borrow the account key');
  state = await background.saveBackground(id, { ...anthropic, useAccountKey: true });
  assert.deepEqual([state.hasKey, state.keySource], [true, 'account']);

  const { routines } = await background.saveRoutine(id, { kind: 'prompt', title: 'Notes', prompt: 'Summarise my notes.', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6] });
  assert.ok(routines[0].nextRun > Date.now(), 'it is scheduled');
  const seen = [];
  const fetcher = async (url, options) => { seen.push(options.headers['x-api-key']); return response(anthropicMessage({ text: 'Nothing new.' })); };
  const result = await background.runClaimed(id, routines[0].id, { force: true, fetcher });
  assert.equal(result.status, 'done');
  assert.deepEqual(seen, ['sk-ant-fixture-account-key-0123456789']);
});

test('a watch keeps an earlier card current without a new message or a push', async () => {
  const { cardIds } = await import('../src/shared/pocket-card-tool.js');
  const card = value => ({ root: 'main', elements: [{ id: 'main', type: 'Metric', props: { label: 'Red bike', value: String(value), unit: 'EUR' }, children: [] }] });
  const userId = await account(), phone = browser(), sent = [];
  await notices.subscribe(userId, phone.subscription);
  const { routines } = await background.saveRoutine(userId, { kind: 'watch', title: 'Bike price', prompt: 'Keep the red bike price current.', time: '08:00', days: [1, 2, 3, 4, 5] });
  const routine = routines[0], service = pushService();
  const chats = async () => (await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats'", args: [userId] })).rows.map(row => JSON.parse(String(row.payload)));
  let replies = [compatibleMessage({ text: 'The red bike today:', calls: [{ name: 'show_card', input: card(900), id: 'call_draw' }] }), compatibleMessage({ text: 'I will keep it current.' })];
  const fetcher = async (url, options) => { sent.push(JSON.parse(options.body)); return response(replies.shift()); };
  try {
    assert.equal((await background.runClaimed(userId, routine.id, { force: true, fetcher })).status, 'done');
    const before = (await chats()).find(chat => chat.turns.some(turn => cardIds(turn.answer).length));
    const [id] = cardIds(before.turns[0].answer), pushed = service.pushed.length;

    replies = [compatibleMessage({ calls: [{ name: 'update_card', input: { id, ...card(850) }, id: 'call_update' }] }), compatibleMessage({ text: 'SKIP' })];
    await execute({ sql: 'UPDATE pocket_pip_routines SET last_run = 0 WHERE user_id = ?', args: [userId] });
    assert.equal((await background.runClaimed(userId, routine.id, { force: true, fetcher })).status, 'unchanged');
    const after = (await chats()).find(chat => chat.uid === before.uid);
    assert.equal(after.turns.length, before.turns.length, 'no new message');
    assert.match(after.turns[0].answer, /850/); assert.doesNotMatch(after.turns[0].answer, /"900"/);
    assert.ok(after.updated > before.updated, 'other devices pull the change');
    assert.equal(service.pushed.length, pushed, 'and nobody is buzzed');
  } finally { service.restore(); }
});

// ── Jobs that report into the big chat (to: 'home') ──
const { writeObject } = await import('../src/server/objects.js');
const runs = await import('../src/server/pip-runs.js');
const CHAT_CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
const doneTurn = (uid, text, answer, created) => ({ uid, text, answer, status: 'done', created, updated: created, context: [], activity: [], sources: [], reasoning: '', error: '' });
async function homeSegment(userId, uid, created, turns = []) {
  await writeObject(userId, 'chats', { uid, title: 'pip', titled: true, home: true, created, updated: created, draft: '', context: [], turns, config: CHAT_CONFIG });
}
const filler = (count, created) => Array.from({ length: count }, (_, index) => doneTurn('f' + created + '-' + index, 'Message ' + index, 'Answer ' + index, created + index));
const chatsOf = async userId => (await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats'", args: [userId] })).rows.map(row => JSON.parse(String(row.payload)));
const segmentsOf = async userId => (await chatsOf(userId)).filter(chat => chat.home).sort((a, b) => a.created - b.created);

test('a job that reports home writes one turn in the current segment, named after the job', async () => {
  const userId = await account(), start = Date.now() - 100000, sent = [];
  await homeSegment(userId, 'home-a', start, filler(3, start));
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Bike prices', prompt: 'Remind me to check the bike prices.', time: '08:00', days: [1], to: 'home' });
  assert.equal(routines[0].to, 'home');
  const result = await background.runClaimed(userId, routines[0].id, { force: true, fetcher: async (url, options) => { sent.push(JSON.parse(options.body)); return response(compatibleMessage({ text: 'Time to check the bike prices.' })); } });
  assert.equal(result.status, 'done', result.error);
  assert.equal(result.chat, 'home-a');
  const [segment] = await segmentsOf(userId);
  assert.equal(segment.turns.length, 4);
  const turn = segment.turns.at(-1);
  assert.deepEqual([turn.text, turn.answer, turn.owner, turn.status], ['Bike prices (job)', 'Time to check the bike prices.', 'pip-routine', 'done']);
  assert.ok(!(await chatsOf(userId)).some(chat => chat.title === 'Pip · Bike prices'), 'no chat of its own');
  // The model was given the job's full instruction and the segment's earlier turns.
  const user = sent[0].messages.filter(message => message.role === 'user').map(message => String(message.content));
  assert.ok(user.at(-1).includes('Remind me to check the bike prices.'));
  assert.ok(user.some(text => text.includes('Message 2')), 'the segment is its history');
  // When the person talks next, the job's turn is an ordinary earlier turn.
  const later = [];
  const view = await runs.submitRun(userId, { requestId: 'req-home-later', chat: { uid: 'home-a', title: 'pip', created: start, config: CHAT_CONFIG, home: true }, text: 'What did the bike job say?', device: 'browser-1' },
    { fetcher: async (url, options) => { later.push(JSON.parse(options.body)); return response(compatibleMessage({ text: 'To check the prices.' })); } });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  const replayed = later[0].messages.map(message => String(message.content || '')).join('\n');
  assert.ok(replayed.includes('Bike prices (job)') && replayed.includes('Time to check the bike prices.'));
});

test('a full segment gets a new one for the job\'s report, with the marks and config of the one before', async () => {
  const userId = await account(), start = Date.now() - 200000;
  await homeSegment(userId, 'home-full', start, filler(60, start));
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Evening', prompt: 'Tell me what is due tomorrow.', time: '19:00', days: [1], to: 'home' });
  const result = await background.runClaimed(userId, routines[0].id, { force: true, fetcher: async () => response(compatibleMessage({ text: 'Nothing is due tomorrow.' })) });
  assert.equal(result.status, 'done', result.error);
  const segments = await segmentsOf(userId);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].turns.length, 60, 'the full segment is untouched');
  assert.deepEqual([segments[1].uid, segments[1].title, segments[1].titled, segments[1].home, segments[1].config.model], [result.chat, 'pip', true, true, 'fixture-model']);
  assert.deepEqual(segments[1].turns.map(turn => turn.text), ['Evening (job)']);
});

test('a quiet watch that answers SKIP writes nothing home, not even a new segment; a failed job writes nothing either', async () => {
  const userId = await account(), start = Date.now() - 300000;
  await homeSegment(userId, 'home-quiet', start, filler(60, start));
  const { routines } = await background.saveRoutine(userId, { kind: 'watch', title: 'Bike watch', prompt: 'A red bike under 800.', time: '08:00', days: [1], to: 'home' });
  const before = JSON.stringify(await segmentsOf(userId));
  assert.equal((await background.runClaimed(userId, routines[0].id, { force: true, fetcher: async () => response(compatibleMessage({ text: 'SKIP' })) })).status, 'unchanged');
  assert.equal(JSON.stringify(await segmentsOf(userId)), before);
  const failed = await background.runClaimed(userId, routines[0].id, { force: true, fetcher: async () => new Response('down', { status: 500 }) });
  assert.equal(failed.status, 'failed');
  assert.equal(JSON.stringify(await segmentsOf(userId)), before, 'the failure shows on the Jobs page, not as a turn');
  assert.equal((await background.backgroundState(userId)).routines[0].lastStatus, 'failed');
});

test('a watch reporting home finds its card in an earlier segment, changes it there and stays silent', async () => {
  const { cardIds } = await import('../src/shared/pocket-card-tool.js');
  const card = value => ({ root: 'main', elements: [{ id: 'main', type: 'Metric', props: { label: 'Red bike', value: String(value), unit: 'EUR' }, children: [] }] });
  const userId = await account(), start = Date.now() - 400000;
  await homeSegment(userId, 'home-cards', start, filler(59, start));
  const { routines } = await background.saveRoutine(userId, { kind: 'watch', title: 'Bike price', prompt: 'Keep the red bike price current.', time: '08:00', days: [1], to: 'home' });
  let replies = [compatibleMessage({ text: 'The red bike today:', calls: [{ name: 'show_card', input: card(900), id: 'call_draw' }] }), compatibleMessage({ text: 'I will keep it current.' })];
  const fetcher = async () => response(replies.shift());
  assert.equal((await background.runClaimed(userId, routines[0].id, { force: true, fetcher })).status, 'done');
  let [segment] = await segmentsOf(userId);
  assert.equal(segment.turns.length, 60, 'the report filled the segment');
  const [id] = cardIds(segment.turns.at(-1).answer);
  assert.ok(id);

  replies = [compatibleMessage({ calls: [{ name: 'update_card', input: { id, ...card(850) }, id: 'call_update' }] }), compatibleMessage({ text: 'SKIP' })];
  assert.equal((await background.runClaimed(userId, routines[0].id, { force: true, fetcher })).status, 'unchanged');
  const segments = await segmentsOf(userId);
  assert.equal(segments.length, 1, 'nothing to say: no new segment');
  segment = segments[0];
  assert.match(segment.turns.at(-1).answer, /850/);
  assert.doesNotMatch(segment.turns.at(-1).answer, /"900"/);
  assert.equal(segment.turns.length, 60);
});

test('a job and a person\'s reply in the home segment at the same time: neither is refused, both end up intact', async () => {
  const userId = await account(), start = Date.now() - 500000;
  await homeSegment(userId, 'home-both', start, filler(2, start));
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Bike prices', prompt: 'Remind me to check the bike prices.', time: '08:00', days: [1], to: 'home' });
  let openJob, openPerson, jobAsked, personAsked;
  const jobGate = new Promise(resolve => { openJob = resolve; }), personGate = new Promise(resolve => { openPerson = resolve; });
  const jobStarted = new Promise(resolve => { jobAsked = resolve; }), personStarted = new Promise(resolve => { personAsked = resolve; });
  const job = background.runClaimed(userId, routines[0].id, { force: true, fetcher: async () => { jobAsked(); await jobGate; return response(compatibleMessage({ text: 'Check the bike prices.' })); } });
  await jobStarted;
  // The job is running; the person writes in the same segment and is not refused.
  const person = runs.submitRun(userId, { requestId: 'req-home-both', chat: { uid: 'home-both', title: 'pip', created: start, config: CHAT_CONFIG, home: true }, text: 'How far is Potsdam by bike?', device: 'browser-1' },
    { fetcher: async () => { personAsked(); await personGate; return response(compatibleMessage({ text: 'About 35 km.' })); } });
  await personStarted;
  // The job finishes while the person's reply still streams.
  openJob();
  assert.equal((await job).status, 'done');
  let [segment] = await segmentsOf(userId);
  assert.ok(segment.turns.some(turn => turn.text === 'Bike prices (job)' && turn.status === 'done'));
  assert.ok(segment.turns.some(turn => turn.text === 'How far is Potsdam by bike?' && turn.status === 'streaming'), 'the person\'s turn is still there while it streams');
  openPerson();
  const view = await person;
  assert.equal(view.run.status, 'done', view.run.turn.error);
  [segment] = await segmentsOf(userId);
  const texts = segment.turns.map(turn => [turn.text, turn.status, turn.answer]);
  assert.deepEqual(texts.slice(2).sort(), [['Bike prices (job)', 'done', 'Check the bike prices.'], ['How far is Potsdam by bike?', 'done', 'About 35 km.']].sort());
  // And the other way round: a job that starts while the person's reply runs is not refused either.
  const blocked = runs.submitRun(userId, { requestId: 'req-home-both-2', chat: { uid: 'home-both', title: 'pip', created: start, config: CHAT_CONFIG, home: true }, text: 'And to Brandenburg?', device: 'browser-1' },
    { fetcher: async () => { await new Promise(resolve => setTimeout(resolve, 50)); return response(compatibleMessage({ text: 'About 70 km.' })); } });
  const second = await background.runClaimed(userId, routines[0].id, { force: true, fetcher: async () => response(compatibleMessage({ text: 'Bike prices again.' })) });
  assert.equal(second.status, 'done', second.error);
  assert.equal((await blocked).run.status, 'done');
  [segment] = await segmentsOf(userId);
  assert.equal(segment.turns.length, 6);
  assert.ok(segment.turns.every(turn => turn.status === 'done'));
});

test('existing jobs keep their own chat: a stored job without `to` reports where it always did', async () => {
  const userId = await account(), start = Date.now() - 600000;
  await homeSegment(userId, 'home-old', start, filler(1, start));
  // Stored as a job was before `to` existed.
  await execute({ sql: 'INSERT INTO pocket_pip_routines (user_id, id, payload, next_run) VALUES (?, ?, ?, ?)',
    args: [userId, 'oldjob', JSON.stringify({ id: 'oldjob', kind: 'prompt', title: 'Old job', prompt: 'Summarise my notes.', time: '07:00', days: [1], enabled: true, delivery: 'notify' }), 1] });
  const result = await background.runClaimed(userId, 'oldjob', { force: true, fetcher: async () => response(compatibleMessage({ text: 'Your notes are about a bike.' })) });
  assert.equal(result.status, 'done', result.error);
  const own = (await chatsOf(userId)).find(chat => chat.uid === result.chat);
  assert.equal(own.title, 'Pip · Old job');
  assert.equal((await segmentsOf(userId))[0].turns.length, 1, 'home is untouched');
  assert.equal((await background.backgroundState(userId)).routines[0].to, undefined, 'the stored job is not rewritten');
  assert.equal(background.backgroundRoutine({ kind: 'prompt', title: 'x', prompt: 'x', time: '07:00', days: [1] }).to, 'own', 'a job saved without a choice reports in its own chat');
  assert.equal(background.backgroundRoutine({ kind: 'watch', title: 'x', prompt: 'x', every: 360, chat: 'c1', card: 'k1', to: 'home' }).to, 'own', 'a card watch answers where its card is');
});

test('a scheduled report repeated after a restart is not delivered twice to the big chat', async () => {
  const userId = await account(), start = Date.now() - 700000;
  await homeSegment(userId, 'home-restart', start, filler(2, start));
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Bike prices', prompt: 'Remind me to check the bike prices.', time: '08:00', days: [1], to: 'home' });
  const id = routines[0].id, slot = Date.now() - 60000;
  await execute({ sql: 'UPDATE pocket_pip_routines SET next_run = ? WHERE user_id = ? AND id = ?', args: [slot, userId, id] });
  let asked = 0;
  const fetcher = async () => { asked++; return response(compatibleMessage({ text: 'Time to check the bike prices.' })); };
  const first = await background.runClaimed(userId, id, { fetcher });
  assert.equal(first.status, 'done', first.error);
  assert.equal(asked, 1);
  // The process stopped after the report was written and before the next time was saved: the same slot is due again.
  await execute({ sql: 'UPDATE pocket_pip_routines SET next_run = ?, lock_until = 0 WHERE user_id = ? AND id = ?', args: [slot, userId, id] });
  const again = await background.runClaimed(userId, id, { fetcher });
  assert.deepEqual([again.status, again.chat, again.turn], ['done', first.chat, first.turn]);
  assert.equal(asked, 1, 'no second request for a report already delivered');
  const [segment] = await segmentsOf(userId);
  assert.equal(segment.turns.filter(turn => turn.text === 'Bike prices (job)').length, 1, 'one report, not two');
  // The next scheduled time is a new report.
  await execute({ sql: 'UPDATE pocket_pip_routines SET next_run = ?, lock_until = 0 WHERE user_id = ? AND id = ?', args: [slot + 1000, userId, id] });
  assert.equal((await background.runClaimed(userId, id, { fetcher })).status, 'done');
  assert.equal((await segmentsOf(userId))[0].turns.filter(turn => turn.text === 'Bike prices (job)').length, 2);
});

// ── Delivered once, wherever it goes, and in the segment that is current when it is written ──
/** A provider reply that waits until opened: `started` resolves when the request is sent. */
function gated(text) {
  let open, started;
  const gate = new Promise(resolve => { open = resolve; }), asked = new Promise(resolve => { started = resolve; });
  return { open, asked, fetcher: async () => { started(); await gate; return response(compatibleMessage({ text })); } };
}
const due = (userId, id, slot) => execute({ sql: 'UPDATE pocket_pip_routines SET next_run = ?, lock_until = 0 WHERE user_id = ? AND id = ?', args: [slot, userId, id] });

test('a report written before the next time was saved is not delivered again: in its own chat in a new month, and home after its segment went', async () => {
  const userId = await account(), slot = Date.now() - 60000;
  let asked = 0;
  const fetcher = async () => { asked++; return response(compatibleMessage({ text: 'Your notes are about a bike.' })); };
  // A job with a chat of its own: the month's chat would be another one when the run is repeated in the next month.
  await execute({ sql: 'INSERT INTO pocket_pip_routines (user_id, id, payload, next_run) VALUES (?, ?, ?, ?)',
    args: [userId, 'ownjob', JSON.stringify({ id: 'ownjob', kind: 'prompt', title: 'Own job', prompt: 'Summarise my notes.', time: '07:00', days: [1], enabled: true, delivery: 'quiet' }), slot] });
  const first = await background.runClaimed(userId, 'ownjob', { fetcher });
  assert.equal(first.status, 'done', first.error);
  await due(userId, 'ownjob', slot);
  const again = await background.runClaimed(userId, 'ownjob', { fetcher, now: Date.now() + 40 * 86400000 });
  assert.deepEqual([again.status, again.chat, again.turn, asked], ['done', first.chat, first.turn, 1]);
  const own = (await chatsOf(userId)).filter(chat => chat.title === 'Pip · Own job');
  assert.equal(own.length, 1, 'no second chat for the next month');
  assert.equal(own[0].turns.filter(turn => turn.status === 'done').length, 1);

  // Home: the segment holding the report was deleted before the run was repeated; the key, not a search, says it went.
  await homeSegment(userId, 'home-gone', Date.now() - 50000, filler(2, Date.now() - 50000));
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Bike prices', prompt: 'Remind me to check the bike prices.', time: '08:00', days: [1], to: 'home', delivery: 'quiet' });
  const home = routines.find(item => item.title === 'Bike prices');
  await due(userId, home.id, slot);
  const delivered = await background.runClaimed(userId, home.id, { fetcher });
  assert.deepEqual([delivered.status, delivered.chat, asked], ['done', 'home-gone', 2]);
  const [segment] = await segmentsOf(userId);
  await writeObject(userId, 'chats', { ...segment, deleted: true, updated: segment.updated + 1 });
  await due(userId, home.id, slot);
  const repeated = await background.runClaimed(userId, home.id, { fetcher });
  assert.deepEqual([repeated.status, repeated.chat, repeated.turn, asked], ['done', delivered.chat, delivered.turn, 2]);
  assert.equal((await chatsOf(userId)).filter(chat => chat.home && !chat.deleted).length, 0, 'no new segment for a report delivered already');
});

test('the same scheduled time claimed twice (a lock that ran out mid-run): one report, both runs charged, the later lock kept', async () => {
  const userId = await account(), slot = Date.now() - 60000;
  await homeSegment(userId, 'home-race', Date.now() - 80000, filler(2, Date.now() - 80000));
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Bike prices', prompt: 'Remind me to check the bike prices.', time: '08:00', days: [1], to: 'home', delivery: 'quiet' });
  const id = routines[0].id;
  await due(userId, id, slot);
  const one = gated('First run.'), two = gated('Second run.');
  const first = background.runClaimed(userId, id, { fetcher: one.fetcher });
  await one.asked;
  // The first run stalls past its lock; the same scheduled time is due and claimed again.
  await execute({ sql: 'UPDATE pocket_pip_routines SET lock_until = 0 WHERE user_id = ? AND id = ?', args: [userId, id] });
  const second = background.runClaimed(userId, id, { fetcher: two.fetcher, now: Date.now() + 1000 });
  await two.asked;
  one.open();
  const a = await first;
  assert.equal(a.status, 'done', a.error);
  const lock = Number((await execute({ sql: 'SELECT lock_until FROM pocket_pip_routines WHERE user_id = ? AND id = ?', args: [userId, id] })).rows[0].lock_until);
  assert.ok(lock > Date.now(), 'the first run leaves the second run\'s lock in place');
  two.open();
  const b = await second;
  assert.deepEqual([b.status, b.chat, b.turn], ['done', a.chat, a.turn], 'the second run answers with the report the first delivered');
  const reports = (await segmentsOf(userId)).flatMap(segment => segment.turns).filter(turn => turn.text === 'Bike prices (job)');
  assert.deepEqual(reports.map(turn => turn.answer), ['First run.']);
  // Both runs asked the model, so both are charged.
  const spent = (reports[0].usage.input_tokens || 0) + (reports[0].usage.output_tokens || 0);
  assert.ok(spent > 0);
  assert.equal((await background.backgroundState(userId)).usedToday, 2 * spent);
});

test('two jobs of one account finish around a full segment: the segment is chosen when each writes, and the person\'s message stays', async () => {
  // 58 turns; the person writes the 59th while both jobs run. The first report fills the segment, the second starts the next.
  const userId = await account(), start = Date.now() - 90000;
  await homeSegment(userId, 'home-edge', start, filler(58, start));
  const made = [];
  for (const title of ['Morning', 'Evening']) made.push((await background.saveRoutine(userId, { kind: 'prompt', title, prompt: title + ' note.', time: '08:00', days: [1], to: 'home', delivery: 'quiet' })).routines.find(item => item.title === title));
  const one = gated('Morning report.'), two = gated('Evening report.');
  const first = background.runClaimed(userId, made[0].id, { force: true, fetcher: one.fetcher });
  const second = background.runClaimed(userId, made[1].id, { force: true, fetcher: two.fetcher });
  await Promise.all([one.asked, two.asked]);
  const [open] = await segmentsOf(userId);
  await writeObject(userId, 'chats', { ...open, updated: open.updated + 1, turns: [doneTurn('person-1', 'Are you there?', 'Yes.', Date.now())] }, { appendTurns: true });
  one.open();
  assert.equal((await first).status, 'done');
  two.open();
  const late = await second;
  assert.equal(late.status, 'done', late.error);
  const segments = await segmentsOf(userId);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].turns.length, 60, 'the segment is not written past full');
  assert.ok(segments[0].turns.some(turn => turn.uid === 'person-1'), 'the person\'s message stays');
  assert.ok(segments[0].turns.some(turn => turn.text === 'Morning (job)'), 'the first report fills the segment');
  assert.deepEqual([segments[1].uid, segments[1].home, segments[1].title, segments[1].turns.map(turn => turn.text)], [late.chat, true, 'pip', ['Evening (job)']]);

  // Already full when both start: they share the one new segment instead of making one each.
  const other = await account(), begin = Date.now() - 90000;
  await homeSegment(other, 'home-full-both', begin, filler(60, begin));
  const jobs = [];
  for (const title of ['Morning', 'Evening']) jobs.push((await background.saveRoutine(other, { kind: 'prompt', title, prompt: title + ' note.', time: '08:00', days: [1], to: 'home', delivery: 'quiet' })).routines.find(item => item.title === title));
  const three = gated('Morning report.'), four = gated('Evening report.');
  const runs3 = [background.runClaimed(other, jobs[0].id, { force: true, fetcher: three.fetcher }), background.runClaimed(other, jobs[1].id, { force: true, fetcher: four.fetcher })];
  await Promise.all([three.asked, four.asked]);
  three.open(); four.open();
  const results = await Promise.all(runs3);
  const after = await segmentsOf(other);
  assert.equal(after.length, 2, 'one new segment, not two');
  assert.equal(results[0].chat, results[1].chat);
  assert.deepEqual(after[1].turns.map(turn => turn.text).sort(), ['Evening (job)', 'Morning (job)']);
  // Nothing of one account is written into another's.
  assert.ok(!(await segmentsOf(userId)).some(segment => segment.uid === after[1].uid));
});
