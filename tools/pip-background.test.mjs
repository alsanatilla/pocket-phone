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

const { trainingRuntime, trainingObservation, trainingChanged } = await import('../src/server/pip-training.js');
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

const userMessage = (chat, text, uid = 'message-1') => ({ chat, text, uid, attempt: 'attempt-' + uid, context: [] });

test('a training conversation opens without a fixed brief and works while automation is paused', async () => {
  const userId = await account(), now = Date.parse('2026-10-09T09:00:00Z');
  await background.saveBackground(userId, { ...settings, enabled: false }, 'fixture-key-123456');
  const { chat } = await background.openTrainingChat(userId, now);
  assert.match(chat, /^pip-training-/);
  const routine = (await background.backgroundState(userId)).routines[0];
  assert.equal(routine.prompt, ''); assert.equal(routine.enabled, false);
  let calls = 0;
  const fetcher = async (_, options) => {
    calls++; assert.equal(options.headers.authorization, 'Bearer fixture-key-123456');
    const body = JSON.parse(options.body);
    assert.ok(body.tools.some(tool => tool.function.name === 'update_training_preferences'));
    assert.match(JSON.stringify(body.messages), /I want to talk about my training/);
    return response(compatibleMessage({ text: 'What are you training for, and how did your last workout feel?' }));
  };
  const options = { now, force: true, fetcher, message: userMessage(chat, 'I want to talk about my training'), trainingServices: { read: () => { throw new Error('Conversation must not require a COROS read.'); } } };
  const result = await background.runClaimed(userId, routine.id, options);
  assert.equal(result.status, 'done'); assert.equal(calls, 1);
  assert.equal(result.reply.uid, 'message-1'); assert.match(result.reply.answer, /What are you training for/);
  const storedChat = await chatOf(userId, chat);
  assert.equal(storedChat.turns.length, 1); assert.equal(storedChat.turns[0].text, options.message.text);
  assert.equal(storedChat.turns[0].status, 'done');
  assert.equal((await background.runClaimed(userId, routine.id, options)).status, 'done');
  assert.equal(calls, 1, 'retry of a completed message must not generate another paid reply');
});

test('conversation preferences and dated feedback guide later automatic reviews and survive a new month', async () => {
  const userId = await account(), now = Date.parse('2026-10-09T09:00:00Z');
  await background.saveBackground(userId, { ...settings, grants: ['gym', 'coros', 'tasks'] }, 'fixture-key-123456');
  const { chat } = await background.openTrainingChat(userId, now);
  const routine = (await background.backgroundState(userId)).routines[0];
  let calls = 0;
  const fetcher = async (_, options) => {
    const body = JSON.parse(options.body); calls++;
    if (calls === 1) return response(compatibleMessage({ calls: [{ name: 'update_training_preferences', id: 'save-goals', input: { brief: 'Train for a relaxed 10k, plus gym twice weekly.', trainingDays: [0, 6], feedback: 'My legs are sore after yesterday’s run.', enabled: true } }] }));
    assert.match(JSON.stringify(body.messages), /training_preferences/);
    return response(compatibleMessage({ text: 'I’ll remember weekends and the 10k goal. How sore are your legs today?' }));
  };
  const result = await background.runClaimed(userId, routine.id, { now, force: true, fetcher, message: userMessage(chat, 'Train me for a relaxed 10k. Weekends only; my legs are sore. Please plan automatically.') });
  assert.equal(result.status, 'done');
  const updated = (await background.backgroundState(userId)).routines[0];
  assert.equal(updated.prompt, 'Train for a relaxed 10k, plus gym twice weekly.');
  assert.deepEqual(updated.trainingDays, [0, 6]); assert.equal(updated.enabled, true);
  assert.match(updated.feedback[0].text, /legs are sore/); assert.equal(updated.feedback[0].at, now);
  let backgroundRequest;
  await background.runRoutine(userId, updated, { now: now + 60000, force: true, trainingServices: { read: trainingRead }, fetcher: async (_, options) => {
    backgroundRequest = JSON.parse(options.body); return response(compatibleMessage({ text: 'Recovery first; keeping the next session gentle.' }));
  } });
  assert.match(JSON.stringify(backgroundRequest.messages), /legs are sore/);
  assert.match(JSON.stringify(backgroundRequest.messages), /How sore are your legs today/);
  assert.ok(!backgroundRequest.tools.some(tool => tool.function.name === 'update_training_preferences'));
  const nextMonth = await background.openTrainingChat(userId, Date.parse('2026-11-01T10:00:00Z'));
  assert.notEqual(nextMonth.chat, chat);
  let nextRequest;
  await background.runClaimed(userId, routine.id, { now: Date.parse('2026-11-01T10:00:00Z'), force: true, message: userMessage(nextMonth.chat, 'Do you remember my goal?', 'message-2'), fetcher: async (_, options) => {
    nextRequest = JSON.parse(options.body); return response(compatibleMessage({ text: 'Yes: a relaxed 10k, with training on weekends.' }));
  } });
  assert.match(nextRequest.messages[0].content, /relaxed 10k/);
});

test('a follow-up can pause training and preserves earlier conversation without changing its brief', async () => {
  const userId = await account(), now = Date.parse('2026-10-09T09:00:00Z');
  await background.saveBackground(userId, { ...settings, grants: ['gym', 'coros', 'tasks'] }, 'fixture-key-123456');
  const state = await background.saveRoutine(userId, trainingRoutine), routine = state.routines[0];
  const { chat } = await background.openTrainingChat(userId, now);
  await background.runClaimed(userId, routine.id, { now, force: true, message: userMessage(chat, 'My last run felt difficult.'), fetcher: async () => response(compatibleMessage({ text: 'Was it your breathing, your legs, or both?' })) });
  let calls = 0;
  const result = await background.runClaimed(userId, routine.id, { now: now + 1000, force: true, message: userMessage(chat, 'My legs. Pause automatic planning for now.', 'message-2'), fetcher: async (_, options) => {
    const body = JSON.parse(options.body);
    assert.match(JSON.stringify(body.messages), /breathing, your legs/);
    return response(++calls === 1 ? compatibleMessage({ calls: [{ name: 'update_training_preferences', id: 'pause', input: { enabled: false, feedback: 'Legs felt tired on the last run.' } }] }) : compatibleMessage({ text: 'Planning is paused. We can still talk about recovery.' }));
  } });
  assert.equal(result.status, 'done');
  const after = (await background.backgroundState(userId)).routines[0];
  assert.equal(after.enabled, false); assert.equal(after.nextRun, 0); assert.equal(after.prompt, trainingRoutine.prompt);
  assert.equal((await chatOf(userId, chat)).turns.length, 2);
});

test('training messages validate identifiers and attachment sizes before execution', () => {
  assert.throws(() => background.trainingMessage(userMessage('ordinary-chat', 'hello')), /training chat/);
  assert.throws(() => background.trainingMessage({ ...userMessage('pip-training-fixture-2026-10', 'hello'), context: [{ title: 'large', text: 'x'.repeat(8001) }] }), /three short sources/);
});
