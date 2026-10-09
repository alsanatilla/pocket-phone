import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleMessage, response } from './pip-provider-fixtures.mjs';

// A real libSQL file database; no Turso account or provider key is used.
const folder = mkdtempSync(join(tmpdir(), 'pocket-pip-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments } = await import('../src/server/workspace.js');
const background = await import('../src/server/pip-background.js');
await ensureSchema();
// Windows releases the database file a moment after close; a leftover temp folder is harmless.
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

let users = 0;
async function account() {
  const id = 'user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes: [{ uid: 'note-car', text: '# Car research\n\nThe blue car costs 21,000 euros.', pinned: false, created: now, updated: now, deleted: false }] } });
  return id;
}
const settings = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks', 'calendar'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
const chatOf = async (userId, uid) => JSON.parse(String((await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, uid] })).rows[0].payload));

test('routine times follow the account timezone across a DST change', () => {
  const { nextRun, zonedTime } = background;
  assert.equal(new Date(zonedTime(2026, 10, 9, 7, 30, 'Europe/Berlin')).toISOString(), '2026-10-09T05:30:00.000Z');
  assert.equal(new Date(zonedTime(2026, 1, 9, 7, 30, 'Europe/Berlin')).toISOString(), '2026-01-09T06:30:00.000Z');
  // 02:30 does not exist on 29 March 2026 in Berlin; the run moves forward with the clock.
  assert.equal(new Date(zonedTime(2026, 3, 29, 2, 30, 'Europe/Berlin')).toISOString(), '2026-03-29T01:30:00.000Z');
  const friday = Date.parse('2026-10-09T06:00:00Z');
  assert.equal(new Date(nextRun({ time: '07:30', days: [1, 2, 3, 4, 5] }, 'Europe/Berlin', friday)).toISOString(), '2026-10-12T05:30:00.000Z');
  assert.equal(new Date(nextRun({ time: '07:30', days: [5] }, 'America/New_York', friday)).toISOString(), '2026-10-09T11:30:00.000Z');
});

test('the key is sealed, and a routine reads the server copy without write tools or calendar', async () => {
  const userId = await account(), sent = [];
  let state = await background.saveBackground(userId, settings, 'fixture-key-123456');
  assert.equal(state.hasKey, true); assert.deepEqual(state.settings.grants, ['notes', 'tasks']);
  const stored = String((await execute({ sql: 'SELECT credentials FROM pocket_pip_background WHERE user_id = ?', args: [userId] })).rows[0].credentials);
  assert.ok(!stored.includes('fixture-key-123456'));
  state = await background.saveRoutine(userId, { kind: 'prompt', title: 'Car watch', prompt: 'What do my notes say about the blue car?', time: '07:30', days: [1, 2, 3, 4, 5] });
  const routine = state.routines[0]; assert.ok(routine.nextRun > Date.now());
  const fetcher = async (url, options) => {
    sent.push(JSON.parse(options.body)); assert.equal(options.headers.authorization, 'Bearer fixture-key-123456');
    return response(sent.length === 1 ? compatibleMessage({ calls: [{ name: 'search_notes', input: { query: 'blue car' }, id: 'call_notes' }] }) : compatibleMessage({ text: 'Your note says the blue car costs 21,000 euros.' }));
  };
  const result = await background.runClaimed(userId, routine.id, { force: true, fetcher });
  assert.equal(result.status, 'done');
  const offered = sent[0].tools.map(tool => tool.function.name);
  assert.ok(offered.includes('search_notes')); assert.ok(!offered.includes('create_record')); assert.ok(!offered.includes('search_calendar'));
  assert.match(sent[0].messages[0].content, /runs on a schedule while the user is away/);
  assert.match(JSON.stringify(sent[1].messages.find(message => message.role === 'tool')), /21,000 euros/);
  const chat = await chatOf(userId, result.chat), turn = chat.turns.at(-1);
  assert.equal(chat.title, 'Pip · Car watch'); assert.equal(turn.owner, background.BACKGROUND_OWNER); assert.equal(turn.status, 'done');
  assert.equal(turn.answer, 'Your note says the blue car costs 21,000 euros.'); assert.equal(chat.config.grants, undefined);
  const after = await background.backgroundState(userId);
  assert.equal(after.usedToday, 36); assert.equal(after.routines[0].lastChat, result.chat); assert.ok(after.routines[0].nextRun > Date.now());
});

test('the job runs due routines once, and the daily limit stops further runs', async () => {
  const userId = await account(); let requests = 0;
  await background.saveBackground(userId, { ...settings, dailyTokens: 1000 }, 'fixture-key-123456');
  const { routines } = await background.saveRoutine(userId, { kind: 'checkin', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6] });
  await execute({ sql: 'UPDATE pocket_pip_routines SET next_run = 1 WHERE user_id = ?', args: [userId] });
  const fetcher = async () => { requests++; return response(compatibleMessage({ text: 'Nothing needs attention today.', usage: { prompt_tokens: 900, completion_tokens: 200, total_tokens: 1100 } })); };
  const first = await background.runPipJob({ fetcher });
  assert.ok(first.ran >= 1); assert.equal(requests, 1);
  assert.equal((await background.runPipJob({ fetcher })).ran, 0);
  const result = await background.runClaimed(userId, routines[0].id, { force: true, fetcher });
  assert.equal(result.status, 'limit'); assert.equal(requests, 1);
  const state = await background.backgroundState(userId);
  assert.match(state.routines[0].lastError, /token limit/); assert.equal(state.usedToday, 1100);
});

test('forgetting the key stops scheduling, and settings are validated', async () => {
  const userId = await account();
  await background.saveBackground(userId, settings, 'fixture-key-123456');
  await background.saveRoutine(userId, { kind: 'checkin', time: '07:00', days: [1] });
  const state = await background.forgetBackgroundKey(userId);
  assert.equal(state.hasKey, false); assert.equal(state.routines[0].nextRun, 0);
  await assert.rejects(background.saveBackground(userId, { ...settings, timezone: 'Mars/Olympus' }), /timezone/);
  await assert.rejects(background.saveRoutine(userId, { kind: 'prompt', title: 'Empty', prompt: '', time: '07:00', days: [1] }), /prompt/);
  await assert.rejects(background.saveRoutine(userId, { kind: 'checkin', time: '25:00', days: [1] }), /time/);
});

const { trainingRuntime } = await import('../src/server/pip-training.js');
const { readDocuments } = await import('../src/server/workspace.js');
const trainingRoutine = { id: 'training-fixture', kind: 'training', prompt: 'Combine running and gym. Maintain fitness.', time: '07:00', days: [0, 1, 2, 3, 4, 5, 6], trainingDays: [0, 1, 2, 3, 4, 5, 6] };
const trainingRead = async (_, name) => ({ text: name === 'queryTrainingSchedule' || name === 'querySportRecords' ? '[]' : '{"recovery":80,"load":40}' });
const gymTask = { kind: 'task', title: 'Gym · Upper body', text: 'Keep legs fresh for the run.', due: '2026-10-10', steps: ['Row: 3 × 8'] };
const runInput = { tool: 'createScheduledWorkout', summary: 'Easy run after recovery', arguments: { date: '20261010', course: { courseName: 'Easy run', sportType: 1, sections: [{ sectionType: 2, targetType: 2, targetValue: 1800 }] } } };

test('training settings require explicit source grants and available days', async () => {
  const userId = await account();
  await background.saveBackground(userId, settings, 'fixture-key-123456');
  await assert.rejects(background.saveRoutine(userId, trainingRoutine), /Gym, COROS and Tasks/);
  await background.saveBackground(userId, { ...settings, grants: ['gym', 'coros', 'tasks'] });
  const state = await background.saveRoutine(userId, trainingRoutine);
  assert.equal(state.routines[0].kind, 'training');
  assert.deepEqual(state.routines[0].trainingDays, trainingRoutine.trainingDays);
  await assert.rejects(background.saveRoutine(userId, { ...trainingRoutine, id: 'another' }), /one training planner/);
  assert.throws(() => background.backgroundRoutine({ ...trainingRoutine, trainingDays: [] }), /available training days/);
});

test('training upserts only its own dated gym task and respects user edits and completion', async () => {
  const userId = await account(), runtime = await trainingRuntime(userId, trainingRoutine, '2026-10-09', { read: trainingRead });
  assert.equal((await runtime.execute('create_record', gymTask)).action.status, 'saved');
  assert.equal((await runtime.execute('create_record', { ...gymTask, title: 'Recovery · Mobility' })).action.status, 'saved');
  let doc = (await readDocuments(userId))['tasks.json'].value;
  assert.equal(doc.tasks.length, 1); assert.equal(doc.tasks[0].text, 'Recovery · Mobility');
  doc.tasks[0].text = 'My edited session'; doc.tasks[0].updated += 5;
  await syncDocuments(userId, { 'tasks.json': doc });
  assert.match((await runtime.execute('create_record', gymTask)).message, /edited manually/);
  doc.tasks[0].done = true; doc.tasks[0].updated += 5;
  await syncDocuments(userId, { 'tasks.json': doc });
  assert.match((await runtime.execute('create_record', gymTask)).message, /completed or removed/);
  assert.ok((await runtime.prepare('create_record', { ...gymTask, kind: 'note' })).error);
  assert.ok((await runtime.prepare('create_record', { ...gymTask, due: '2026-10-09' })).error);
  assert.ok((await runtime.prepare('create_record', { ...gymTask, due: '2026-10-17' })).error);
});

test('missing live data, unavailable days and revoked authorization block all training writes', async () => {
  const userId = await account(); let allowed = true;
  const runtime = await trainingRuntime(userId, trainingRoutine, '2026-10-09', { read: async (_, name) => name === 'queryRecoveryStatus' ? { error: true } : trainingRead(_, name) });
  assert.match((await runtime.prepare('create_record', gymTask)).message, /incomplete/);
  const restricted = await trainingRuntime(userId, { ...trainingRoutine, trainingDays: [1] }, '2026-10-09', { read: trainingRead });
  assert.ok((await restricted.prepare('create_record', gymTask)).error);
  const revoked = await trainingRuntime(userId, trainingRoutine, '2026-10-09', { read: trainingRead, authorized: async () => allowed });
  allowed = false;
  assert.match((await revoked.execute('create_record', gymTask)).message, /paused/);
});

test('COROS writes need complete formats, deduplicate across runs, and protect manual workouts', async () => {
  const userId = await account(), writes = []; let details = 'Manual workout';
  const services = { read: async (id, name) => name === 'queryScheduledWorkoutDetails' ? { text: details } : trainingRead(id, name),
    write: async (id, key, tool, args) => { writes.push(args); await execute({ sql: "INSERT INTO pocket_coros_writes (user_id, key, tool, state, result, updated_at) VALUES (?, ?, ?, 'done', '', ?)", args: [id, key, tool, Date.now()] }); } };
  const runtime = await trainingRuntime(userId, trainingRoutine, '2026-10-09', services);
  assert.match((await runtime.prepare('coros_write', runInput)).message, /every page/);
  runtime.observe('coros_format', { tool: runInput.tool, offset: 100 }, { truncated: false });
  assert.ok((await runtime.prepare('coros_write', runInput)).error);
  runtime.observe('coros_format', { tool: runInput.tool }, { truncated: false });
  assert.equal((await runtime.execute('coros_write', runInput)).action.status, 'saved');
  const next = await trainingRuntime(userId, trainingRoutine, '2026-10-09', services);
  next.observe('coros_format', { tool: runInput.tool }, { truncated: false });
  assert.equal((await next.execute('coros_write', runInput)).repeated, true); assert.equal(writes.length, 1);
  const update = { ...runInput, tool: 'updateScheduledWorkout', arguments: { ...runInput.arguments, idInPlan: '17' } };
  next.observe('coros_format', { tool: update.tool }, { truncated: false });
  assert.match((await next.execute('coros_write', update)).message, /Only a workout created/);
  details = JSON.stringify(writes[0]);
  assert.equal((await next.execute('coros_write', update)).action.status, 'saved');
  assert.equal(writes.length, 2);
});

test('training uses the actual SDK approval loop to save a gym task without a browser', async () => {
  const userId = await account(), runtime = await trainingRuntime(userId, trainingRoutine, '2026-10-09', { read: trainingRead });
  const { streamChat } = await import('../src/client/pip-stream.js');
  const value = { ...settings, grants: ['gym', 'coros', 'tasks'] }, turn = { uid: 'training-turn', text: 'Plan my training', activity: [] }, chat = { uid: 'training-chat', turns: [turn], config: value };
  let calls = 0;
  const reply = await streamChat(chat, turn, { value, key: 'fixture-key', body: { instructions: 'Plan training.', messages: [{ role: 'user', content: runtime.prompt }], tools: ['create_record'] },
    previewTool: (_, name, input) => runtime.prepare(name, input), approve: runtime.approve, executeTool: (_, name, input) => runtime.execute(name, input),
    fetcher: async () => response(++calls === 1 ? compatibleMessage({ calls: [{ name: 'create_record', input: gymTask, id: 'gym-call' }] }) : compatibleMessage({ text: 'Gym saved for tomorrow.' })) });
  assert.equal(reply.answer, 'Gym saved for tomorrow.');
  assert.equal((await readDocuments(userId))['tasks.json'].value.tasks.length, 1);
  assert.ok(reply.activity.some(row => row.applied_href?.startsWith('/tasks/')));
});
