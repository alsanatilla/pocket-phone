import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compatibleMessage, response } from './pip-provider-fixtures.mjs';

// Jobs set up by saying so: the four job tools on a server reply, their refusals in the validator's words, the
// approval before a removal, the limits a job inherits from its chat, and where the tools are never offered.
// A real libSQL file database; no Turso account or provider key is used.
const folder = mkdtempSync(join(tmpdir(), 'pocket-job-tools-'));
process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db').replaceAll('\\', '/');
process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
const { ensureSchema, execute, database } = await import('../src/server/database.js');
const { syncDocuments } = await import('../src/server/workspace.js');
const background = await import('../src/server/pip-background.js');
const runs = await import('../src/server/pip-runs.js');
const { jobTool, scheduleWords } = await import('../src/server/pip-job-tools.js');
const { toolNames, summary, label } = await import('../src/client/pip-tools.js');
await ensureSchema();
test.after(() => { database().close(); try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {} });

const SETTINGS = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
const CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
let users = 0;
async function account() {
  const id = 'jobtools-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes: [{ uid: 'n1', text: '# Bike\n\nThe red bike costs 900 euros.', pinned: false, created: now, updated: now, deleted: false }] } });
  await background.saveBackground(id, SETTINGS, 'fixture-key-123456');
  return id;
}
const header = uid => ({ uid, title: 'Pip run', created: Date.now(), config: CONFIG });
/** A provider double that records each request and streams the next prepared reply. */
const provider = (sent, replies) => async (url, options) => {
  sent.push(JSON.parse(options.body));
  return replies.length ? response(replies.shift()) : new Response(JSON.stringify({ error: { message: 'The fixture expected no further request.' } }), { status: 400 });
};
let requests = 0;
const say = (userId, chat, text, sent, replies, extra = {}) => runs.submitRun(userId, { requestId: 'req-' + ++requests, chat: header(chat), text, device: 'browser-1', ...extra }, { fetcher: provider(sent, replies) });
const call = (name, input, id = 'call_' + name) => compatibleMessage({ calls: [{ name, input, id }] });
const toolMessages = request => request.messages.filter(message => message.role === 'tool').map(message => String(message.content));
const jobs = async userId => (await background.backgroundState(userId)).routines;

test('a job is created by a tool call, saved at once, and seen in backgroundState with its schedule in the account timezone', async () => {
  const userId = await account(), sent = [];
  const view = await say(userId, 'chat-create', 'Remind me every Monday at 8 to check the bike prices.', sent, [
    call('create_job', { kind: 'prompt', title: 'Bike prices', prompt: 'Remind me to check the bike prices.', time: '08:00', days: ['mon'] }),
    compatibleMessage({ text: 'Done: every Monday at 08:00.' }),
  ]);
  assert.equal(view.run.status, 'done', view.run.turn.error);
  const [job] = await jobs(userId);
  assert.deepEqual([job.kind, job.title, job.time, job.days, job.to, job.enabled, job.delivery], ['prompt', 'Bike prices', '08:00', [1], 'home', true, 'notify']);
  assert.ok(job.nextRun > Date.now(), 'it is scheduled');
  // The next run is at 08:00 on a Monday in Berlin.
  const wall = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(job.nextRun);
  assert.equal(wall, 'Mon 08:00');
  const row = view.run.turn.activity.find(item => item.name === 'create_job');
  assert.equal(row.state, 'done');
  assert.equal(row.summary, 'scheduled · Bike prices');
  const result = JSON.parse(row.result);
  assert.deepEqual([result.done, result.schedule, result.timezone, result.id], ['scheduled', 'Mon 08:00', 'Europe/Berlin', job.id]);
  const offered = sent[0].tools.map(tool => tool.function.name);
  for (const name of ['list_jobs', 'create_job', 'change_job', 'remove_job']) assert.ok(offered.includes(name), name + ' is offered on a server reply');
});

test('invalid input is answered with the validator\'s sentence, and the corrected call saves', async () => {
  const userId = await account(), sent = [];
  const view = await say(userId, 'chat-invalid', 'Check the bike shop every five minutes.', sent, [
    call('create_job', { kind: 'watch', title: 'Bike shop', prompt: 'New bikes in the shop.', every: 5 }, 'call_bad'),
    call('create_job', { kind: 'watch', title: 'Bike shop', prompt: 'New bikes in the shop.', every: 15 }, 'call_good'),
    compatibleMessage({ text: 'Every 15 minutes is the most often I can.' }),
  ]);
  assert.equal(view.run.status, 'done', view.run.turn.error);
  assert.ok(toolMessages(sent[1]).some(text => text.includes('invalid_job') && text.includes('Run every 15 minutes to 24 hours.')), 'the model reads the sentence');
  assert.deepEqual((await jobs(userId)).map(job => [job.kind, job.every]), [['watch', 15]]);
  // The other refusals the Jobs page gives, as the model gets them.
  assert.match((await jobTool(userId, 'create_job', { kind: 'prompt', title: 'x', prompt: 'x', at: '2020-01-01 08:00' }, { chat: 'c', turn: 't', eventId: '1' })).message, /within the next year/);
  assert.match((await jobTool(userId, 'create_job', { kind: 'prompt', title: 'x', prompt: 'x', at: 'tomorrow' }, { chat: 'c', turn: 't', eventId: '2' })).message, /YYYY-MM-DD HH:MM.*Europe\/Berlin/);
  assert.match((await jobTool(userId, 'create_job', { kind: 'prompt', title: '', prompt: 'x', time: '08:00', days: ['mon'] }, { chat: 'c', turn: 't', eventId: '3' })).message, /Give the routine a name/);
  assert.match((await jobTool(userId, 'create_job', { kind: 'training', title: 'x' }, { chat: 'c', turn: 't', eventId: '4' })).message, /scheduled prompt, a standing watch/);
  assert.match((await jobTool(userId, 'create_job', { kind: 'brief', title: 'Due tomorrow', prompt: 'Tell me what is due tomorrow.', time: '19:00', days: ['mon'] }, { chat: 'c', turn: 't', eventId: '5' })).message, /take no prompt/);
});

test('a moment is read in the account timezone, and a call made again after a restart saves the same job', async () => {
  const userId = await account(), context = { chat: 'chat-once', turn: 'turn-1', eventId: 'row-1' };
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' }).format(Date.now() + 14 * 86400000);
  const input = { kind: 'prompt', title: 'Call Sam', prompt: 'Remind me to call Sam.', at: day + ' 18:30' };
  const first = await jobTool(userId, 'create_job', input, context);
  const again = await jobTool(userId, 'create_job', input, context);
  assert.equal(first.id, again.id);
  const all = await jobs(userId);
  assert.equal(all.length, 1, 'one job, not two');
  const [year, month, date] = day.split('-').map(Number);
  assert.equal(all[0].at, background.zonedTime(year, month, date, 18, 30, 'Europe/Berlin'), '18:30 in Berlin');
  assert.equal(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(all[0].at), '18:30');
  assert.equal(first.schedule, 'once · ' + day + ' 18:30');
});

test('change, pause and resume save at once and say which they were; the training planner is out of reach', async () => {
  const userId = await account(), context = { chat: 'chat-change', turn: 'turn-1', eventId: 'row-1', value: { grants: ['notes', 'tasks'], webSearch: true } };
  const created = await jobTool(userId, 'create_job', { kind: 'prompt', title: 'Due tomorrow', prompt: 'Tell me what is due tomorrow.', time: '19:00', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] }, context);
  assert.equal(created.schedule, 'daily 19:00');

  const moved = await jobTool(userId, 'change_job', { id: created.id, time: '20:30' }, context);
  assert.deepEqual([moved.done, moved.schedule, moved.title], ['changed', 'daily 20:30', 'Due tomorrow']);
  const interval = await jobTool(userId, 'change_job', { id: created.id, every: 120, active_from: '08:00', active_until: '22:00' }, context);
  assert.deepEqual([interval.done, interval.schedule], ['changed', 'every 2 h · 08:00–22:00']);
  const back = await jobTool(userId, 'change_job', { id: created.id, time: '07:00', days: ['mon', 'fri'] }, context);
  assert.equal(back.schedule, 'Mon Fri 07:00', 'a new time replaces the interval');
  assert.equal((await jobs(userId))[0].every, undefined);

  const paused = await jobTool(userId, 'change_job', { id: created.id, enabled: false }, context);
  assert.deepEqual([paused.done, paused.enabled, paused.next], ['paused', false, null]);
  assert.equal((await jobs(userId))[0].nextRun, 0, 'a paused job is not scheduled');
  const resumed = await jobTool(userId, 'change_job', { id: created.id, enabled: true }, context);
  assert.equal(resumed.done, 'resumed');
  assert.ok((await jobs(userId))[0].nextRun > Date.now());

  assert.equal((await jobTool(userId, 'change_job', { id: 'nope', time: '09:00' }, context)).error, 'job_not_found');
  assert.match((await jobTool(userId, 'change_job', { id: created.id, kind: 'watch' }, context)).message, /keeps its kind/);
  assert.match((await jobTool(userId, 'change_job', { id: created.id, time: '25:00' }, context)).message, /Choose a time/);

  await background.saveBackground(userId, { ...SETTINGS, grants: ['notes', 'tasks', 'gym', 'coros'] });
  const { routines } = await background.saveRoutine(userId, { kind: 'training', title: 'Training', time: '07:00', days: [1], trainingDays: [1, 3], enabled: false });
  const training = routines.find(item => item.kind === 'training');
  assert.match((await jobTool(userId, 'change_job', { id: training.id, enabled: false }, context)).message, /training planner/);
  assert.match((await jobTool(userId, 'remove_job', { id: training.id }, context)).message, /training planner/);
});

test('list_jobs answers what Pip does on its own, with ids to refer to', async () => {
  const userId = await account(), sent = [];
  await background.saveRoutine(userId, { kind: 'checkin', time: '07:30', days: [1, 2, 3, 4, 5] });
  await background.saveRoutine(userId, { kind: 'watch', title: 'Bike prices', prompt: 'Red bike under 850.', every: 60, delivery: 'quiet' });
  const view = await say(userId, 'chat-list', 'What do you do for me on your own?', sent, [call('list_jobs', {}), compatibleMessage({ text: 'Two things.' })]);
  assert.equal(view.run.status, 'done', view.run.turn.error);
  const listed = JSON.parse(toolMessages(sent[1])[0]);
  assert.equal(listed.timezone, 'Europe/Berlin'); assert.equal(listed.on, true); assert.equal(listed.limit, 12);
  assert.deepEqual(listed.jobs.map(job => [job.title, job.schedule, job.to, job.enabled]), [['Morning check-in', 'weekdays 07:30', 'own', true], ['Bike prices', 'every hour', 'own', true]]);
  assert.equal(listed.jobs[1].quiet, true);
  assert.ok(listed.jobs.every(job => typeof job.id === 'string' && job.next));
  assert.equal(view.run.turn.activity.find(item => item.name === 'list_jobs').summary, '2 jobs');
});

test('removing a job waits for the person: declined it stays, approved it goes', async () => {
  const userId = await account();
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Monday reminder', prompt: 'Remind me to check the bike prices.', time: '08:00', days: [1] });
  const id = routines[0].id;
  let sent = [];
  const declined = await say(userId, 'chat-remove', 'Stop the Monday reminder.', sent, [call('remove_job', { id }, 'call_remove_1'), compatibleMessage({ text: 'Kept it.' })]);
  assert.equal(declined.run.status, 'awaiting', 'the run waits for approval');
  const [request] = (await execute({ sql: 'SELECT request_id, payload FROM pocket_pip_run_requests WHERE user_id = ? AND run_id = ?', args: [userId, declined.run.runId] })).rows;
  assert.equal(JSON.parse(String(request.payload)).action.title, 'Monday reminder · Mon 08:00', 'the person sees which job and when');
  assert.equal((await jobs(userId)).length, 1, 'nothing removed before a decision');
  const afterDecline = await runs.decideRun(userId, { runId: declined.run.runId, requestId: String(request.request_id), approved: false }, { fetcher: provider(sent, [compatibleMessage({ text: 'Kept it.' })]) });
  assert.equal(afterDecline.run.status, 'done', afterDecline.run.turn.error);
  assert.equal((await jobs(userId)).length, 1, 'declined: it stays');

  sent = [];
  const asked = await say(userId, 'chat-remove', 'Yes, stop the Monday reminder.', sent, [call('remove_job', { id }, 'call_remove_2')]);
  const [second] = (await execute({ sql: "SELECT request_id FROM pocket_pip_run_requests WHERE user_id = ? AND run_id = ? AND state = 'pending'", args: [userId, asked.run.runId] })).rows;
  const approved = await runs.decideRun(userId, { runId: asked.run.runId, requestId: String(second.request_id), approved: true }, { fetcher: provider(sent, [compatibleMessage({ text: 'Removed.' })]) });
  assert.equal(approved.run.status, 'done', approved.run.turn.error);
  assert.deepEqual(await jobs(userId), [], 'approved: it is gone');
  const row = approved.run.turn.activity.find(item => item.name === 'remove_job');
  assert.deepEqual([row.state, JSON.parse(row.result).done, JSON.parse(row.result).title], ['done', 'removed', 'Monday reminder']);
});

test('a job never has more access than the chat that created it', async () => {
  const userId = await account(), sent = [];
  // The chat may read notes only; the background settings allow notes and tasks.
  const view = await say(userId, 'chat-grants', 'Each evening, tell me what is due tomorrow.', sent, [
    call('create_job', { kind: 'prompt', title: 'Due tomorrow', prompt: 'Tell me what is due tomorrow.', time: '19:00', days: ['mon', 'tue'] }),
    compatibleMessage({ text: 'Set up.' }),
  ], { grants: ['notes'] });
  assert.equal(view.run.status, 'done', view.run.turn.error);
  const [job] = await jobs(userId);
  assert.deepEqual(job.grants, ['notes']);
  const ran = [];
  const result = await background.runClaimed(userId, job.id, { force: true, fetcher: provider(ran, [compatibleMessage({ text: 'Nothing is due tomorrow.' })]) });
  assert.equal(result.status, 'done', result.error);
  const offered = ran[0].tools.map(tool => tool.function.name);
  assert.ok(offered.includes('search_notes'));
  assert.ok(!offered.includes('search_tasks'), 'tasks stay closed although the background settings allow them');
  assert.ok(!offered.includes('search_web'), 'no web for a job whose chat had none');
  // Changed from a chat that reads nothing, it reads nothing.
  await jobTool(userId, 'change_job', { id: job.id, time: '19:30' }, { chat: 'c', turn: 't', eventId: 'e', value: { grants: [] } });
  assert.deepEqual((await jobs(userId))[0].grants, []);
  // A job made on the Jobs page carries no limit of its own and reads what the settings allow, as before.
  const page = (await background.saveRoutine(userId, { kind: 'prompt', title: 'Page job', prompt: 'Summarise.', time: '07:00', days: [1] })).routines.find(item => item.title === 'Page job');
  assert.equal(page.grants, undefined);
});

test('a job never creates jobs, and the tab path is never offered the tools', async () => {
  const userId = await account(), ran = [];
  const { routines } = await background.saveRoutine(userId, { kind: 'prompt', title: 'Notes', prompt: 'Set up a reminder for tomorrow.', time: '07:00', days: [1] });
  await background.runClaimed(userId, routines[0].id, { force: true, fetcher: provider(ran, [compatibleMessage({ text: 'I cannot set up jobs from here.' })]) });
  const offered = ran[0].tools.map(tool => tool.function.name);
  for (const name of ['list_jobs', 'create_job', 'change_job', 'remove_job']) assert.ok(!offered.includes(name), name + ' is not offered inside a job');

  const chat = { provider: 'compatible', baseUrl: 'https://model.example/v1', model: 'm', grants: ['notes'] };
  assert.ok(!toolNames(chat).some(name => name.endsWith('_job') || name === 'list_jobs'), 'not on the tab path');
  assert.ok(!toolNames({ ...chat, memory: true }).includes('create_job'), 'memory alone does not offer them');
  assert.ok(toolNames({ ...chat, jobs: true }).includes('create_job'));
  assert.ok(!toolNames({ ...chat, jobs: true, backgroundJob: true }).includes('create_job'), 'a job\'s value never offers them');
  assert.equal(label('change_job', { id: 'x', enabled: false }), 'pause a job');
  assert.equal(summary('create_job', { kind: 'job', done: 'scheduled', title: 'Bike prices' }), 'scheduled · Bike prices');
  assert.equal(scheduleWords({ every: 30, days: [1, 2, 3, 4, 5], activeHours: { start: '08:00', end: '00:00' } }, 'UTC'), 'every 30 min · 08:00–24:00 · weekdays');
});

test('the thirteenth job is refused with the sentence the Jobs page shows', async () => {
  const userId = await account();
  for (let index = 0; index < 12; index++) await background.saveRoutine(userId, { kind: 'prompt', title: 'Job ' + index, prompt: 'x', time: '07:00', days: [1] });
  const refused = await jobTool(userId, 'create_job', { kind: 'prompt', title: 'One more', prompt: 'x', time: '07:00', days: ['mon'] }, { chat: 'c', turn: 't', eventId: 'e' });
  assert.deepEqual([refused.error, refused.message], ['invalid_job', 'Keep up to 12 routines.']);
});

test('the same job asked for twice is one job; a removal replayed after it went is said plainly', async () => {
  const userId = await account(), input = { kind: 'prompt', title: 'Bike prices', prompt: 'Remind me to check the bike prices.', time: '08:00', days: ['mon'] };
  const first = await jobTool(userId, 'create_job', input, { chat: 'c', turn: 't1', eventId: 'a' });
  const twin = await jobTool(userId, 'create_job', { ...input, title: 'bike prices' }, { chat: 'c', turn: 't2', eventId: 'b' });
  assert.deepEqual([twin.done, twin.id, twin.existing], ['scheduled', first.id, true]);
  assert.equal((await jobs(userId)).length, 1);
  // A different time is a different job.
  assert.notEqual((await jobTool(userId, 'create_job', { ...input, time: '09:00' }, { chat: 'c', turn: 't3', eventId: 'c' })).id, first.id);
  assert.equal((await jobs(userId)).length, 2);
  await jobTool(userId, 'remove_job', { id: first.id }, { chat: 'c', turn: 't4', eventId: 'd' });
  const replay = await jobTool(userId, 'remove_job', { id: first.id }, { chat: 'c', turn: 't4', eventId: 'd' });
  assert.equal(replay.error, 'job_not_found');
  assert.match(replay.message, /removed already/);
});

test('without background settings a moment is read in the chat\'s timezone, and the receipt says the job will not run yet', async () => {
  const id = 'jobtools-bare-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now + 7 * 86400000);
  const made = await jobTool(id, 'create_job', { kind: 'prompt', title: 'Call Sam', prompt: 'Remind me to call Sam.', at: day + ' 18:30' }, { chat: 'c', turn: 't', eventId: 'e', value: { timezone: 'America/New_York' } });
  assert.equal(made.timezone, 'America/New_York');
  assert.equal(made.off, true);
  const [year, month, date] = day.split('-').map(Number);
  assert.equal((await jobs(id))[0].at, background.zonedTime(year, month, date, 18, 30, 'America/New_York'));
  // A timezone that is not one falls back to UTC.
  assert.equal((await jobTool(id, 'list_jobs', {}, { value: { timezone: 'Mars/Olympus' } })).timezone, 'UTC');
});
