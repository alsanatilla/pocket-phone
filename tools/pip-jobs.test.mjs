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
