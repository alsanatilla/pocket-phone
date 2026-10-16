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
  // Both the run that answered and the run the limit stopped are readable afterwards, newest first.
  assert.deepEqual(state.runs.map(run => run.status), ['limit', 'done']);
  assert.match(state.runs[0].error, /token limit/);
});

test('every claimed run is recorded, and a failure stays visible afterwards', async () => {
  const userId = await account();
  await background.saveBackground(userId, settings, 'fixture-key-123456');
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Car watch', prompt: 'Anything about the blue car?', time: '07:30', days: [1] });
  const id = routines[0].id;
  const good = await background.runClaimed(userId, id, { force: true, fetcher: async () => response(compatibleMessage({ text: 'Nothing needs attention.' })) });
  assert.equal(good.status, 'done');
  // A provider that answers with an unreadable stream fails the run rather than the job.
  const failed = await background.runClaimed(userId, id, { force: true, fetcher: async () => response('data: {"broken":true}\r\n\r\n') });
  assert.equal(failed.status, 'failed'); assert.ok(failed.error);
  const state = await background.backgroundState(userId);
  assert.equal(state.routines[0].lastStatus, 'failed'); assert.match(state.routines[0].lastError, /./);
  assert.deepEqual(state.runs.map(run => run.status), ['failed', 'done']);
  assert.equal(state.runs[0].title, 'Car watch'); assert.equal(state.runs[0].kind, 'prompt'); assert.ok(state.runs[0].error);
  assert.equal(state.runs[1].chat, good.chat);
})

test('a routine keeps one chat of its own, pinned, and starts a new one only when it is full or deleted', async () => {
  const { writeObject } = await import('../src/server/objects.js');
  const userId = await account();
  await background.saveBackground(userId, settings, 'fixture-key-123456');
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Car watch', prompt: 'Anything about the blue car?', time: '07:30', days: [1, 2, 3, 4, 5] });
  const id = routines[0].id, fetcher = async () => response(compatibleMessage({ text: 'Nothing new.' }));
  const first = await background.runClaimed(userId, id, { force: true, now: Date.parse('2026-10-09T06:00:00Z'), fetcher });
  assert.equal(first.chat, 'pip-routine-' + id);
  const chat = await chatOf(userId, first.chat);
  assert.equal(chat.title, 'Pip · Car watch'); assert.equal(chat.pinned, true, 'the routine chat is pinned so it keeps its place');
  assert.equal(chat.turns.length, 1);
  // A month later the same routine writes into the same chat instead of starting a new one.
  const second = await background.runClaimed(userId, id, { force: true, now: Date.parse('2026-11-09T06:00:00Z'), fetcher });
  assert.equal(second.chat, first.chat); assert.equal((await chatOf(userId, first.chat)).turns.length, 2);
  // A chat that is full rolls over, and the routine remembers where it writes now.
  const full = await chatOf(userId, first.chat);
  await writeObject(userId, 'chats', { ...full, updated: full.updated + 1, pinned: true,
    turns: Array.from({ length: 1990 }, (unused, index) => ({ uid: 'turn-' + index, text: 'x', context: [], status: 'done', answer: '' })) });
  const third = await background.runClaimed(userId, id, { force: true, now: Date.parse('2026-11-10T06:00:00Z'), fetcher });
  assert.notEqual(third.chat, first.chat); assert.equal((await chatOf(userId, third.chat)).turns.length, 1);
  assert.equal((await background.backgroundState(userId)).routines[0].chat, third.chat);
  const fourth = await background.runClaimed(userId, id, { force: true, now: Date.parse('2026-11-11T06:00:00Z'), fetcher });
  assert.equal(fourth.chat, third.chat); assert.equal((await chatOf(userId, third.chat)).turns.length, 2);
  // Deleting the routine's chat does not silence it forever: the next run starts a fresh thread.
  await writeObject(userId, 'chats', { uid: third.chat, updated: Date.now(), deleted: true });
  const fifth = await background.runClaimed(userId, id, { force: true, now: Date.parse('2026-11-12T06:00:00Z'), fetcher });
  assert.notEqual(fifth.chat, third.chat); assert.equal((await chatOf(userId, fifth.chat)).turns.length, 1);
});

test('a routine adopts the chat an earlier version wrote into, instead of starting a new one', async () => {
  const userId = await account();
  await background.saveBackground(userId, settings, 'fixture-key-123456');
  const now = Date.parse('2026-10-09T06:00:00Z');
  // The chat a monthly version left behind, and a routine that does not know about it yet.
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Car watch', prompt: 'Anything about the blue car?', time: '07:30', days: [1, 2, 3, 4, 5] });
  const id = routines[0].id, legacy = 'pip-routine-' + id + '-2026-10';
  const { writeObject } = await import('../src/server/objects.js');
  await writeObject(userId, 'chats', { uid: legacy, title: 'Pip · Car watch', created: now - 3600000, updated: now - 3600000, draft: '', context: [], turns: [], config: { provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', maxTokens: 4096, thinking: false, webSearch: false } });
  const run = await background.runClaimed(userId, id, { force: true, now, fetcher: async () => response(compatibleMessage({ text: 'Nothing new.' })) });
  assert.equal(run.chat, legacy, 'the routine keeps its existing chat');
  const chat = await chatOf(userId, legacy);
  assert.equal(chat.turns.length, 1); assert.equal(chat.pinned, true);
  assert.equal((await background.backgroundState(userId)).routines[0].chat, legacy);
});

test('a routine reply keeps the pin the user chose while it ran', async () => {
  const { writeObject } = await import('../src/server/objects.js');
  const userId = await account();
  await background.saveBackground(userId, settings, 'fixture-key-123456');
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Car watch', prompt: 'Anything about the blue car?', time: '07:30', days: [1, 2, 3, 4, 5] });
  const id = routines[0].id, reply = async () => response(compatibleMessage({ text: 'Nothing new.' }));
  const first = await background.runClaimed(userId, id, { force: true, now: Date.parse('2026-10-09T06:00:00Z'), fetcher: reply });
  // The user unpins the routine's chat while the next run waits for the provider.
  const unpin = async () => { const chat = await chatOf(userId, first.chat); await writeObject(userId, 'chats', { ...chat, pinned: false, updated: chat.updated + 1 }); return reply(); };
  await background.runClaimed(userId, id, { force: true, now: Date.parse('2026-10-10T06:00:00Z'), fetcher: unpin });
  const chat = await chatOf(userId, first.chat);
  assert.equal(chat.turns.length, 2); assert.equal(chat.pinned, false, 'the reply does not pin the chat again');
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

const { trainingRuntime, trainingObservation, trainingChanged, trainingCheckpoint } = await import('../src/server/pip-training.js');
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
  assert.ok((await runtime.prepare('create_record', { ...gymTask, due: '2026-10-13' })).error);
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

const completedRun = (id = '101', pace = '5:40/km') => `Sport Records — 2026-09-25 to 2026-10-09 (1 records)\n\n1. Outdoor Run — 2026-10-09\n   Distance: 5.0 km | Duration: 00:28:20\n   Average Pace: ${pace} | Avg HR: 148\n   LabelId: ${id} | SportType: 100`;

test('workout reviews fetch actual session details and refuse writes when details are missing', async () => {
  const userId = await account(), calls = [];
  const read = async (id, name, args) => {
    calls.push({ name, args });
    if (name === 'querySportRecords') return { text: completedRun() };
    if (name === 'getActivityDetail') return { text: 'Pace 5:40/km; HR 148; completed 5 km; intervals: 5 × 1 km.' };
    return trainingRead(id, name);
  };
  const runtime = await trainingRuntime(userId, trainingRoutine, '2026-10-09', { read });
  assert.deepEqual(calls.find(call => call.name === 'getActivityDetail').args, { labelId: '101', sportType: 100 });
  assert.match(runtime.prompt, /completed 5 km/);
  assert.match(runtime.prompt, /next one or two/);
  assert.match(runtime.prompt, /compare actual duration/);
  assert.equal(runtime.complete, true);
  const missing = await trainingRuntime(userId, trainingRoutine, '2026-10-09', { read: (id, name, args) => name === 'getActivityDetail' ? { error: true } : read(id, name, args) });
  assert.equal(missing.complete, false);
  assert.match((await missing.execute('create_record', gymTask)).message, /getActivityDetail:101/);
});

test('completed gym workouts trigger reviews; active workouts and refresh timestamps do not', async () => {
  const userId = await account(), at = Date.parse('2026-10-09T07:00:00Z');
  const before = await trainingObservation(userId, '2026-10-09', { read: trainingRead });
  const workout = { id: 'gym-1', started: at, ended: 0, updated: at, entries: [{ exercise: 'Squat', sets: [{ reps: 5, kg: 60 }] }] };
  await syncDocuments(userId, { 'gym.json': { v: 1, workouts: [workout] } });
  let after = await trainingObservation(userId, '2026-10-09', { read: trainingRead });
  assert.equal(after.gym.length, 0);
  assert.equal(trainingChanged(before, after), false);
  workout.ended = at + 3600000; workout.updated++;
  await syncDocuments(userId, { 'gym.json': { v: 1, workouts: [workout] } });
  after = await trainingObservation(userId, '2026-10-09', { read: trainingRead });
  assert.equal(trainingChanged(before, after), true); assert.equal(after.gym.length, 1);
  workout.updated++;
  await syncDocuments(userId, { 'gym.json': { v: 1, workouts: [workout] } });
  assert.equal(trainingChanged(after, await trainingObservation(userId, '2026-10-09', { read: trainingRead })), false);
});

test('background checks run AI only for changed workouts, the daily recovery check, or run now', async () => {
  const userId = await account(); let requests = 0, records = completedRun();
  await background.saveBackground(userId, { ...settings, grants: ['gym', 'coros', 'tasks'] }, 'fixture-key-123456');
  const { routines } = await background.saveRoutine(userId, trainingRoutine), routine = routines[0];
  assert.ok(routine.nextRun - Date.now() <= 30 * 60000);
  const options = { now: Date.parse('2026-10-09T08:00:00Z'),
    fetcher: async () => { requests++; return response(compatibleMessage({ text: 'Reviewed the latest run. Keep the next session easy.' })); },
    trainingServices: { read: async (id, name) => name === 'querySportRecords' ? { text: records } : name === 'getActivityDetail' ? { text: 'Completed 5 km, average HR 148.' } : trainingRead(id, name) } };
  const first = await background.runClaimed(userId, routine.id, { ...options, force: true });
  assert.equal(first.status, 'done'); assert.equal(requests, 1);
  assert.equal((await background.runRoutine(userId, routine, options)).status, 'unchanged'); assert.equal(requests, 1);
  records = completedRun('101', '5:30/km');
  assert.equal((await background.runRoutine(userId, routine, options)).status, 'done'); assert.equal(requests, 2);
  records = completedRun('102');
  assert.equal((await background.runRoutine(userId, routine, options)).status, 'done'); assert.equal(requests, 3);
  await execute({ sql: 'UPDATE pocket_pip_routines SET next_run = 0 WHERE user_id = ?', args: [userId] });
  assert.equal((await background.runClaimed(userId, routine.id, options)).status, 'unchanged');
  assert.equal((await background.backgroundState(userId)).routines[0].lastChat, first.chat);
  assert.equal((await background.runRoutine(userId, routine, { ...options, now: options.now + 86400000 })).status, 'done'); assert.equal(requests, 4);
  assert.equal((await background.runRoutine(userId, routine, { ...options, now: options.now + 86400000, force: true })).status, 'done'); assert.equal(requests, 5);
});

test('two upcoming sessions is a shared limit across parallel writes and subsequent reviews', async () => {
  const userId = await account(), runtime = await trainingRuntime(userId, trainingRoutine, '2026-10-09', { read: trainingRead });
  const results = await Promise.all(['2026-10-10', '2026-10-11', '2026-10-12'].map(due => runtime.execute('create_record', { ...gymTask, due })));
  assert.equal(results.filter(result => result.action?.status === 'saved').length, 2);
  assert.match(results[2].message, /Two upcoming sessions/);
  const next = await trainingRuntime(userId, trainingRoutine, '2026-10-09', { read: trainingRead });
  assert.match((await next.execute('create_record', { ...gymTask, due: '2026-10-12' })).message, /Two upcoming sessions/);
  assert.equal((await next.execute('create_record', { ...gymTask, title: 'Recovery · Easy mobility' })).action.status, 'saved');
  const tomorrow = await trainingRuntime(userId, trainingRoutine, '2026-10-10', { read: trainingRead });
  assert.equal((await tomorrow.execute('create_record', { ...gymTask, due: '2026-10-12' })).action.status, 'saved');
});

const { writeObject } = await import('../src/server/objects.js');
const userChat = (uid, turns, now = Date.parse('2026-10-09T08:00:00Z')) => ({ uid, title: 'Running', created: now, updated: now, draft: '', context: [], config: { provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', maxTokens: 4096, thinking: false, webSearch: false },
  turns: turns.map(([text, answer], index) => ({ uid: uid + '-turn-' + index, text, answer, status: 'done', created: now + index, updated: now + index, context: [], activity: [], sources: [] })) });

test('training preferences save from any chat; automatic planning waits for a goal and setup', async () => {
  const userId = await account(), now = Date.parse('2026-10-09T09:00:00Z');
  let saved = await background.saveTrainingPreferences(userId, 'chat-a', { trainingDays: [0, 6], feedback: 'Legs sore after the long run.', enabled: true }, now);
  assert.equal(saved.automatic, 'off'); assert.match(saved.setup, /training for/);
  saved = await background.saveTrainingPreferences(userId, 'chat-a', { brief: 'Relaxed 10k in spring, gym twice a week.', enabled: true }, now);
  assert.equal(saved.automatic, 'off'); assert.match(saved.setup, /dedicated key/);
  let [routine] = (await background.backgroundState(userId)).routines;
  assert.equal(routine.kind, 'training'); assert.equal(routine.chat, 'chat-a'); assert.equal(routine.enabled, false); assert.equal(routine.nextRun, 0);
  assert.deepEqual(routine.trainingDays, [0, 6]); assert.equal(routine.feedback.length, 1); assert.equal(routine.feedback[0].at, now);
  await background.saveBackground(userId, { ...settings, grants: ['gym', 'coros', 'tasks'] }, 'fixture-key-123456');
  assert.equal((await background.backgroundState(userId)).trainingReady, true);
  saved = await background.saveTrainingPreferences(userId, 'chat-b', { enabled: true }, now);
  assert.equal(saved.automatic, 'on'); assert.equal(saved.setup, undefined);
  [routine] = (await background.backgroundState(userId)).routines;
  assert.equal(routine.chat, 'chat-b'); assert.equal(routine.prompt, 'Relaxed 10k in spring, gym twice a week.'); assert.deepEqual(routine.trainingDays, [0, 6]); assert.ok(routine.nextRun > 0);
  saved = await background.saveTrainingPreferences(userId, 'chat-b', { enabled: false, feedback: 'Travelling this week.' }, now + 1000);
  [routine] = (await background.backgroundState(userId)).routines;
  assert.equal(saved.automatic, 'off'); assert.equal(routine.nextRun, 0); assert.equal(routine.prompt, 'Relaxed 10k in spring, gym twice a week.'); assert.equal(routine.feedback.length, 2);
  await assert.rejects(background.saveTrainingPreferences(userId, '../chat', { enabled: true }), /Pip chat/);
  for (const input of [null, [], {}, { enabled: 'false' }, { brief: ' ' }, { feedback: 'x'.repeat(1001) }, { trainingDays: [7] }]) {
    await assert.rejects(background.saveTrainingPreferences(userId, 'chat-b', input), error => error.status === 400);
  }
  assert.equal((await background.backgroundState(userId)).routines.length, 1);
});

test('automatic reviews reply in the chat where training was discussed, after the user\'s own turns', async () => {
  const userId = await account(), now = Date.parse('2026-10-09T09:00:00Z');
  await background.saveBackground(userId, { ...settings, grants: ['gym', 'coros', 'tasks'] }, 'fixture-key-123456');
  await writeObject(userId, 'chats', userChat('chat-main', [['My legs are sore after the long run.', 'Then keep tomorrow easy.']]));
  await background.saveTrainingPreferences(userId, 'chat-main', { brief: 'Relaxed 10k.', feedback: 'Legs sore after the long run.', enabled: true }, now);
  let [routine] = (await background.backgroundState(userId)).routines, request;
  const result = await background.runRoutine(userId, routine, { now, force: true, trainingServices: { read: trainingRead }, fetcher: async (_, options) => {
    const edited = await chatOf(userId, 'chat-main');
    edited.title = 'Running and gym'; edited.config.maxTokens = 2048; edited.draft = 'How about tomorrow?'; edited.updated = now + 1000;
    await writeObject(userId, 'chats', edited);
    request = JSON.parse(options.body); return response(compatibleMessage({ text: 'Recovery first; tomorrow stays easy.' }));
  } });
  assert.equal(result.status, 'done'); assert.equal(result.chat, 'chat-main');
  const text = JSON.stringify(request.messages);
  assert.match(text, /My legs are sore after the long run/); assert.match(text, /Relaxed 10k/); assert.match(text, /ongoing Pip chat/);
  assert.ok(!request.tools.some(tool => tool.function.name === 'update_training_preferences'));
  let chat = await chatOf(userId, 'chat-main');
  assert.equal(chat.turns.length, 2); assert.equal(chat.config.provider, 'anthropic');
  assert.equal(chat.title, 'Running and gym'); assert.equal(chat.config.maxTokens, 2048); assert.equal(chat.draft, 'How about tomorrow?');
  assert.equal(chat.turns[1].owner, background.BACKGROUND_OWNER); assert.equal(chat.turns[1].answer, 'Recovery first; tomorrow stays easy.');
  // The browser's copy without Pip's turn merges instead of replacing it.
  const browser = userChat('chat-main', [['My legs are sore after the long run.', 'Then keep tomorrow easy.']]);
  browser.turns.push({ uid: 'later', text: 'Thanks!', answer: 'Anytime.', status: 'done', created: now + 60000, updated: now + 60000, context: [] }); browser.updated = now + 60000;
  await writeObject(userId, 'chats', browser);
  chat = await chatOf(userId, 'chat-main');
  assert.deepEqual(chat.turns.map(turn => turn.text.slice(0, 12)), ['My legs are ', chat.turns[1].text.slice(0, 12), 'Thanks!']);
  // A deleted chat moves the reviews to the user's latest chat.
  await writeObject(userId, 'chats', userChat('chat-other', [['How was my week?', 'Steady.']], now + 120000));
  await writeObject(userId, 'chats', { uid: 'chat-main', updated: now + 180000, deleted: true });
  [routine] = (await background.backgroundState(userId)).routines;
  const next = await background.runRoutine(userId, routine, { now: now + 200000, force: true, trainingServices: { read: trainingRead }, fetcher: async () => response(compatibleMessage({ text: 'Still easy.' })) });
  assert.equal(next.chat, 'chat-other'); assert.equal((await background.backgroundState(userId)).routines[0].chat, 'chat-other');
  assert.equal((await chatOf(userId, 'chat-other')).turns.length, 2);
});

test('new feedback during an automatic review blocks stale workout writes and keeps a new review due', async () => {
  const userId = await account(), now = Date.parse('2026-10-09T09:00:00Z');
  await background.saveBackground(userId, { ...settings, grants: ['gym', 'coros', 'tasks'] }, 'fixture-key-123456');
  await background.saveTrainingPreferences(userId, 'chat-main', { brief: 'Run and gym.', enabled: true }, now);
  const [routine] = (await background.backgroundState(userId)).routines;
  let calls = 0;
  await background.runRoutine(userId, routine, { now, force: true, trainingServices: { read: trainingRead }, fetcher: async () => {
    if (++calls === 1) {
      await background.saveTrainingPreferences(userId, 'chat-main', { feedback: 'My legs hurt; I need rest.' }, now + 1000);
      return response(compatibleMessage({ calls: [{ name: 'create_record', id: 'stale-gym', input: gymTask }] }));
    }
    return response(compatibleMessage({ text: 'Your feedback changed; I will review it before planning.' }));
  } });
  const docs = await (await import('../src/server/workspace.js')).readDocuments(userId);
  assert.equal(docs['tasks.json']?.value?.tasks?.length || 0, 0);
  assert.equal(await trainingCheckpoint(userId, routine.id), null);
});
