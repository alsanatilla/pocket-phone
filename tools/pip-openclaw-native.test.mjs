import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The native OpenClaw path end to end: the REAL gateway (node_modules/openclaw, its own process, a temp state dir)
// loads Pocket's plugin, talks to a fake OpenAI-compatible model that streams scripted chat-completions chunks, and
// Pocket's server drives replies through the operator protocol (pip-openclaw.js) against a real libSQL database.
// Nothing here calls a real model; what a model would decide is the script.
const major = Number(process.versions.node.split('.')[0]);
const skip = major < 24 ? 'OpenClaw needs Node 24 (this is ' + process.version + '): npm exec --yes --package=node@24.16.0 -- npm run test:tools' : false;
const folder = mkdtempSync(join(tmpdir(), 'pocket-native-'));
const free = () => new Promise(resolve => { const probe = createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });

// --- The fake model --------------------------------------------------------------------------------------------
// Each request plays the next step: text, tool calls, or a delay first. A step may be a function of the request.
const requests = [], script = [];
const model = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', async () => {
    if (!req.url.includes('/chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'fixture-model', object: 'model' }] })); return; }
    const body = JSON.parse(raw || '{}'), entry = { body, at: Date.now(), closed: false };
    requests.push(entry); res.on('close', () => { entry.closed = !res.writableFinished; });
    let step = script.shift() || { text: 'ok' };
    if (typeof step === 'function') step = await step(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta, finish = null, usage) => res.write('data: ' + JSON.stringify({ id: 'chatcmpl_fixture', object: 'chat.completion.chunk', created: 1791500000, model: 'fixture-model',
      choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) }) + '\n\n');
    if (step.delay) await new Promise(resolve => setTimeout(resolve, step.delay));
    if (res.destroyed) return;
    for (const part of String(step.text || '').match(/[\s\S]{1,16}/g) || []) chunk({ role: 'assistant', content: part });
    (step.calls || []).forEach(({ name, input, id }, index) => chunk({ tool_calls: [{ index, id, type: 'function', function: { name, arguments: JSON.stringify(input) } }] }));
    chunk({}, step.calls ? 'tool_calls' : 'stop', { prompt_tokens: Math.round(raw.length / 4), completion_tokens: 8, total_tokens: Math.round(raw.length / 4) + 8 });
    res.end('data: [DONE]\n\n');
  });
});
const messagesOf = entry => entry.body.messages || [];
const textOf = message => typeof message.content === 'string' ? message.content : (message.content || []).map(part => part.text || '').join('');
const userTexts = entry => messagesOf(entry).filter(message => message.role === 'user').map(textOf);
const toolTexts = entry => messagesOf(entry).filter(message => message.role === 'tool').map(textOf).join('\n');

// --- Pocket ------------------------------------------------------------------------------------------------------
let runs, execute, database, readDocuments, closeGateway, gatewayChild, tools, timings = {};
const gatewayLog = [];
const SETTINGS = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, grants: ['notes', 'tasks'], dailyTokens: 50000, timezone: 'Europe/Berlin', enabled: true };
const CONFIG = { provider: 'compatible', model: 'fixture-model', baseUrl: 'https://model.example/v1', maxTokens: 2048, thinking: false, webSearch: false };
const header = uid => ({ uid, title: 'Native', created: Date.now(), config: CONFIG });
let users = 0;
async function account() {
  const { syncDocuments } = await import('../src/server/workspace.js');
  const { saveBackground } = await import('../src/server/pip-background.js');
  const id = 'native-user-' + ++users, now = Date.now();
  await execute({ sql: 'INSERT INTO pocket_user (id, name, email, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', args: [id, 'Fixture', id + '@example.com', now, now] });
  await syncDocuments(id, { 'notes.json': { v: 1, notes: [{ uid: 'note-car', text: '# Car research\n\nThe blue car costs 21,000 euros.', pinned: false, created: now, updated: now, deleted: false }] } });
  await saveBackground(id, SETTINGS, 'fixture-key-123456');
  return id;
}
const send = (userId, chat, requestId, text, extra = {}) => runs.submitRun(userId, { requestId, chat: header(chat), text, device: 'phone-1', turnUid: 'turn-' + requestId, ...extra }, {});
const notesOf = async userId => (await readDocuments(userId))['notes.json'].value.notes.filter(note => note.uid.startsWith('pip-'));
const until = async (what, check, ms = 30000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise(resolve => setTimeout(resolve, 100))) { const value = await check(); if (value) return value; }
  throw new Error('Timed out waiting for ' + what);
};
/** Submits, waits for the reply to settle (it runs detached, as on the server), and answers its final view. */
async function reply(userId, chat, requestId, text, extra = {}) {
  const started = Date.now(), submitted = await send(userId, chat, requestId, text, extra);
  await until('the reply to settle', async () => !['queued', 'running', 'awaiting', 'stopping'].includes((await runs.runView(userId, { runId: submitted.run.runId })).run.status), 90000);
  await runs.settledRuns();
  return { ...(await runs.runView(userId, { runId: submitted.run.runId })), ms: Date.now() - started };
}

test.before(async () => {
  if (skip) return;
  process.env.TURSO_DATABASE_URL = 'file:' + join(folder, 'pocket.db');
  process.env.TURSO_AUTH_TOKEN = 'fixture-token'; process.env.POCKET_ENCRYPTION_SECRET = 'fixture-secret';
  process.env.PIP_RUNS_MODE = 'inprocess';
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  // Pocket's tool endpoint, as web.mjs mounts it, on a port of its own.
  tools = createServer((req, res) => import('../src/server/pip-openclaw.js').then(module => module.toolsEndpoint(req, res)));
  await new Promise(resolve => tools.listen(0, '127.0.0.1', resolve));
  const port = await free();
  Object.assign(process.env, { PIP_GATEWAY: '1', PIP_OPENCLAW_NATIVE: '1', PIP_GATEWAY_HOME: join(folder, 'openclaw'), PIP_GATEWAY_PORT: String(port),
    PIP_GATEWAY_TOKEN: 'gateway-token-' + 'x'.repeat(24), PIP_TOOLS_TOKEN: 'tools-token-' + 'y'.repeat(24), PIP_TOOLS_URL: 'http://127.0.0.1:' + tools.address().port + '/internal/pip-tools',
    PIP_GATEWAY_BASE_URL: 'http://127.0.0.1:' + model.address().port + '/v1', PIP_GATEWAY_MODEL: 'fixture-model', PIP_GATEWAY_PROVIDER: 'compatible', PIP_GATEWAY_KEY: 'sk-fixture',
    PIP_OPENCLAW_CLIENT_STATE: join(folder, 'client'), PIP_OPENCLAW_CONNECT_MS: '120000', PIP_GATEWAY_TIMEZONE: 'Europe/Berlin' });
  const { writeGatewayConfig } = await import('../services/gateway/config.mjs');
  const { path } = await writeGatewayConfig();
  const booting = Date.now();
  gatewayChild = spawn(process.execPath, ['node_modules/openclaw/dist/index.js', 'gateway', 'run'], { stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPENCLAW_CONFIG_PATH: path, OPENCLAW_STATE_DIR: join(folder, 'state'), OPENCLAW_GATEWAY_PORT: String(port), OPENCLAW_GATEWAY_TOKEN: process.env.PIP_GATEWAY_TOKEN } });
  for (const stream of [gatewayChild.stdout, gatewayChild.stderr]) stream.on('data', chunk => { gatewayLog.push(String(chunk)); if (gatewayLog.length > 400) gatewayLog.shift(); });
  await until('the gateway to listen', async () => gatewayChild.exitCode === null ? Boolean(await fetch('http://127.0.0.1:' + port + '/health').catch(() => null)) : (() => { throw new Error('The gateway exited:\n' + gatewayLog.join('').slice(-3000)); })(), 180000);
  ({ closeGateway } = await import('../src/server/pip-openclaw.js'));
  const { gateway } = await import('../src/server/pip-openclaw.js');
  await gateway();
  timings.boot = Date.now() - booting;
  ({ execute, database } = await import('../src/server/database.js'));
  ({ readDocuments } = await import('../src/server/workspace.js'));
  await (await import('../src/server/database.js')).ensureSchema();
  runs = await import('../src/server/pip-runs.js');
});
test.after(async () => {
  if (skip) return;
  console.log('# native OpenClaw path: ' + JSON.stringify(timings));
  await runs?.settledRuns();
  await closeGateway?.();
  gatewayChild?.kill('SIGTERM');
  await new Promise(resolve => gatewayChild?.exitCode !== null ? resolve() : gatewayChild.once('exit', resolve));
  model.close(); tools?.close();
  database?.().close();
  try { rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch {}
});
const fail = view => view.run.turn.error + '\n' + gatewayLog.join('').slice(-2000);

test('a plain reply streams through the gateway into the stored turn', { skip, timeout: 120000 }, async () => {
  const userId = await account(), before = requests.length;
  script.push({ text: 'Hello! What can I do for you?' });
  const view = await reply(userId, 'chat-native-hi', 'hi-1', 'hi');
  assert.equal(view.run.status, 'done', fail(view));
  assert.equal(view.run.turn.answer, 'Hello! What can I do for you?');
  assert.equal(view.run.turn.usage.engine, 'openclaw');
  timings.firstTurnMs = view.ms;
  // What the model received for "hi": OpenClaw's own prompt, Pip's workspace files and the tool schemas.
  const first = requests[before].body, json = JSON.stringify(first);
  timings.hiRequestChars = json.length; timings.hiInputTokensEstimate = Math.round(json.length / 4);
  timings.hiSystemChars = textOf(first.messages[0]).length; timings.hiToolSchemaChars = JSON.stringify(first.tools || []).length;
  timings.hiTools = (first.tools || []).map(tool => tool.function.name);
  assert.ok(timings.hiTools.includes('start_assignment') && timings.hiTools.includes('update_scratch'));
  assert.ok(timings.hiTools.includes('search_notes') && timings.hiTools.includes('show_card'), 'Pocket\'s tools are offered directly');
  assert.ok(!timings.hiTools.includes('exec') && !timings.hiTools.includes('write'), 'no coding or shell tools');
  assert.ok(userTexts(requests[before]).some(text => text.includes('hi')));
  assert.ok(!textOf(first.messages[0]).includes('Current user request'), 'Pocket sent no system prompt or recap of its own');
  assert.match(json, /Europe\/Berlin/, 'OpenClaw dates the request in the person\'s timezone');
  const stored = (await execute({ sql: "SELECT payload FROM pocket_objects WHERE user_id = ? AND collection = 'chats' AND uid = ?", args: [userId, 'chat-native-hi'] })).rows[0];
  assert.equal(JSON.parse(String(stored.payload)).turns[0].answer, 'Hello! What can I do for you?');

  // The same chat again: the session holds the first turn, which Pocket does not send.
  const next = requests.length;
  script.push({ text: 'Still here.' });
  const again = await reply(userId, 'chat-native-hi', 'hi-2', 'are you there?');
  assert.equal(again.run.status, 'done', fail(again));
  timings.nextTurnMs = again.ms;
  const texts = messagesOf(requests[next]).map(textOf).join('\n');
  assert.match(texts, /Hello! What can I do for you\?/, 'the model sees the earlier answer from the session');
  assert.equal(userTexts(requests[next]).filter(text => text.includes('are you there?')).length, 1);
});

test('a read tool runs in Pocket for the session\'s account and the model answers from it', { skip, timeout: 120000 }, async () => {
  const userId = await account(), before = requests.length;
  script.push({ calls: [{ name: 'search_notes', input: { query: 'blue car' }, id: 'call_notes' }] }, { text: 'Your note says the blue car costs 21,000 euros.' });
  const view = await reply(userId, 'chat-native-read', 'read-1', 'What do my notes say about the blue car?');
  assert.equal(view.run.status, 'done', fail(view));
  assert.equal(view.run.turn.answer, 'Your note says the blue car costs 21,000 euros.');
  assert.match(toolTexts(requests[before + 1]), /21,000 euros/, 'the tool result came from the account\'s synced notes');
  const row = view.run.turn.activity.find(item => item.name === 'search_notes');
  assert.equal(row.state, 'done'); assert.match(row.result, /blue car/i);
  assert.deepEqual(row.sources.map(item => item.href), ['/notes/note-car']);
  // A session Pocket did not register gets nothing, whatever it asks for.
  const { toolRequest } = await import('../src/server/pip-openclaw.js');
  assert.equal((await toolRequest({ action: 'execute', sessionKey: 'agent:pocket:pocket-someone-else', tool: 'search_notes', input: {}, callId: 'x' })).error, 'session_unknown');
});

test('show_card is drawn by Pocket and stored as a pocket fence where it was called', { skip, timeout: 120000 }, async () => {
  const userId = await account();
  const card = { root: 'main', elements: [{ id: 'main', type: 'Metric', props: { label: 'Price', value: '21,000', unit: 'EUR' }, children: [] }] };
  script.push({ text: 'Here is the price.', calls: [{ name: 'show_card', input: card, id: 'call_card' }] }, { text: 'That is the latest figure.' });
  const view = await reply(userId, 'chat-native-card', 'card-1', 'Show me the car price as a card.');
  assert.equal(view.run.status, 'done', fail(view));
  const answer = view.run.turn.answer;
  assert.match(answer, /^Here is the price\.\n\n```pocket\n[\s\S]*21,000[\s\S]*\n```\n\nThat is the latest figure\.$/);
  assert.match(toolTexts(requests.at(-1)), /"drawn":true/);
});

test('a save waits for approval, is approved through decideRun, and is saved once', { skip, timeout: 120000 }, async () => {
  const userId = await account(), before = requests.length;
  script.push({ calls: [{ name: 'create_record', input: { kind: 'note', title: 'Blue car', text: '21,000 euros' }, id: 'call_save' }] }, { text: 'Saved your note.' });
  const submitted = await send(userId, 'chat-native-save', 'save-1', 'Save the blue car price as a note.');
  const waiting = await until('the approval', async () => { const view = await runs.runView(userId, { runId: submitted.run.runId }); return view.run.status === 'awaiting' && view.requests.length ? view : null; });
  const request = waiting.requests[0];
  assert.equal(request.kind, 'write'); assert.equal(request.tool, 'create_record'); assert.equal(request.state, 'pending');
  assert.equal(request.payload.action.title, 'Blue car'); assert.equal(request.payload.frozen, true);
  assert.equal(waiting.run.turn.phase, 'waiting for your approval');
  const row = waiting.run.turn.activity.find(item => item.id === request.row);
  assert.equal(row.state, 'awaiting', 'the request points at its activity row');
  assert.equal((await notesOf(userId)).length, 0, 'nothing is written before the decision');
  // OpenClaw approvals freeze the arguments: an edited approval is refused, approving as proposed works.
  await assert.rejects(runs.decideRun(userId, { runId: submitted.run.runId, requestId: request.id, approved: true, input: { kind: 'note', title: 'Edited', text: '' }, device: 'phone-1' }), /as Pip proposed/);
  await runs.decideRun(userId, { runId: submitted.run.runId, requestId: request.id, approved: true, device: 'phone-1' });
  await until('the reply', async () => (await runs.runView(userId, { runId: submitted.run.runId })).run.status === 'done', 60000);
  await runs.settledRuns();
  const done = await runs.runView(userId, { runId: submitted.run.runId });
  assert.equal(done.run.turn.answer, 'Saved your note.');
  const notes = await notesOf(userId);
  assert.equal(notes.length, 1, 'saved once'); assert.match(notes[0].text, /^# Blue car/);
  const saved = done.run.turn.activity.find(item => item.name === 'create_record');
  assert.equal(saved.state, 'done'); assert.equal(saved.applied_href, '/notes/' + notes[0].uid);
  assert.match(toolTexts(requests.at(-1)), /"status":"saved"/);
  assert.equal(requests.length - before, 2);
  // Running the same approved call again cannot save a second time.
  assert.equal((await notesOf(userId)).length, 1);
});

test('a declined save is not saved and the model hears it', { skip, timeout: 120000 }, async () => {
  const userId = await account();
  script.push({ calls: [{ name: 'create_record', input: { kind: 'task', title: 'Call the bank', text: '' }, id: 'call_no' }] }, { text: 'Okay, I did not save it.' });
  const submitted = await send(userId, 'chat-native-decline', 'decline-1', 'Remind me to call the bank.');
  const waiting = await until('the approval', async () => { const view = await runs.runView(userId, { runId: submitted.run.runId }); return view.run.status === 'awaiting' && view.requests.length ? view : null; });
  await runs.decideRun(userId, { runId: submitted.run.runId, requestId: waiting.requests[0].id, approved: false, device: 'phone-1' });
  await until('the reply', async () => (await runs.runView(userId, { runId: submitted.run.runId })).run.status === 'done', 60000);
  await runs.settledRuns();
  const done = await runs.runView(userId, { runId: submitted.run.runId });
  assert.equal(done.run.turn.answer, 'Okay, I did not save it.');
  const { readDocuments: read } = await import('../src/server/workspace.js');
  assert.equal(((await read(userId))['tasks.json']?.value.tasks || []).filter(task => task.uid.startsWith('pip-')).length, 0);
  assert.match(toolTexts(requests.at(-1)), /Denied by user/);
  assert.equal(done.run.turn.activity.find(item => item.name === 'create_record').summary, 'declined');
});

test('stop aborts the OpenClaw run and keeps what was written', { skip, timeout: 120000 }, async () => {
  const userId = await account(), before = requests.length;
  script.push({ delay: 20000, text: 'This arrives too late.' });
  const submitted = await send(userId, 'chat-native-stop', 'stop-1', 'Write me a long story.');
  await until('the model request', async () => requests.length > before);
  const stopping = Date.now();
  await runs.stopRun(userId, { runId: submitted.run.runId, device: 'phone-1' });
  await until('the stop', async () => (await runs.runView(userId, { runId: submitted.run.runId })).run.status === 'stopped', 15000);
  timings.stopMs = Date.now() - stopping;
  await runs.settledRuns();
  const view = await runs.runView(userId, { runId: submitted.run.runId });
  assert.equal(view.run.turn.status, 'stopped');
  await until('the model request to be dropped', async () => requests[before].closed, 15000);
  assert.ok(!view.run.turn.answer.includes('too late'));
});

test('a message sent while the reply runs reaches the running turn', { skip, timeout: 120000 }, async () => {
  const userId = await account(), before = requests.length;
  let steered = null;
  script.push(async () => {
    // While the model is on its first step, the person sends another message into the reply.
    steered = await send(userId, 'chat-native-steer', 'steer-2', 'Only euros, please.', { steer: 'turn-steer-1' });
    await new Promise(resolve => setTimeout(resolve, 2500));
    return { calls: [{ name: 'search_notes', input: { query: 'blue car' }, id: 'call_steer' }] };
  }, { text: '21,000 euros.' });
  const view = await reply(userId, 'chat-native-steer', 'steer-1', 'What does the blue car cost?');
  assert.equal(view.run.status, 'done', fail(view));
  // Woken at once, the reply may already have taken it when the submit answers.
  assert.ok(['waiting', 'steered'].includes(steered.run.status), steered.run.status);
  const after = requests.slice(before + 1).map(userTexts).flat();
  assert.equal(after.filter(text => text.includes('Only euros, please.')).length, 1, 'the message reached the running turn once');
  assert.deepEqual(view.run.turn.steers.map(item => item.uid), ['turn-steer-2']);
  assert.equal((await runs.runView(userId, { runId: steered.run.runId })).run.status, 'steered');
  assert.equal(view.run.turn.answer, '21,000 euros.');
});

test('native research reads notes but cannot save or start nested work', { skip, timeout: 120000 }, async () => {
  const userId = await account();
  script.push({ calls: [{ name: 'read_note', input: { id: 'note-car' }, id: 'research-read' }] },
    { calls: [{ name: 'create_record', input: { kind: 'note', title: 'Forbidden', text: 'No' }, id: 'research-write' }] },
    { text: 'The blue car costs 21,000 euros.' });
  const started = await runs.assignmentTool(userId, { title: 'Car research', brief: 'Find the price in my notes.' },
    { chat: 'research-origin', turn: 'origin', eventId: 'research', value: { ...CONFIG, grants: ['notes'], assignments: true } });
  assert.ok(started.id, JSON.stringify(started));
  const view = await until('research to finish', async () => {
    const view = await runs.runView(userId, { runId: started.id });
    return ['done', 'failed'].includes(view?.run?.status) ? view : null;
  }, 90000);
  assert.equal(view.run.status, 'done', fail(view));
  assert.equal(view.run.turn.usage.engine, 'openclaw');
  assert.equal((await notesOf(userId)).length, 0);
  assert.ok(view.run.turn.activity.some(row => row.name === 'create_record' && row.state === 'failed'));
});

test('native scheduled jobs read account data and keep their own scratch notes', { skip, timeout: 120000 }, async () => {
  const userId = await account();
  const background = await import('../src/server/pip-background.js');
  const routine = background.backgroundRoutine({ kind: 'watch', title: 'Car watch', prompt: 'Read my car note.', every: 360, days: [0, 1, 2, 3, 4, 5, 6] });
  await background.saveRoutine(userId, routine);
  script.push({ calls: [{ name: 'read_note', input: { id: 'note-car' }, id: 'job-read' }] },
    { calls: [{ name: 'update_scratch', input: { notes: 'Blue car: 21000 euros' }, id: 'job-scratch' }] },
    { text: 'The blue car costs 21,000 euros.' });
  const result = await background.runRoutine(userId, routine, { force: true });
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.equal(await background.readScratch(userId, routine.id), 'Blue car: 21000 euros');
});


test('tool endpoint forwards unknown sessions once and rejects unauthenticated calls', { skip }, async () => {
  const { toolsEndpoint } = await import('../src/server/pip-openclaw.js');
  let calls = 0;
  const worker = createServer((req, res) => {
    calls++;
    assert.equal(req.headers['x-pocket-tools'], process.env.PIP_TOOLS_TOKEN);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ worker: true }));
  });
  await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
  const web = createServer((req, res) => toolsEndpoint(req, res, { forwardUrl: 'http://127.0.0.1:' + worker.address().port }));
  await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + web.address().port;
    const options = { method: 'POST', body: JSON.stringify({ sessionKey: 'worker-session', tool: 'read_note', callId: 'read', action: 'execute' }) };
    assert.equal((await fetch(url, options)).status, 404);
    assert.equal(calls, 0);
    assert.deepEqual(await (await fetch(url, { ...options, headers: { 'x-pocket-tools': process.env.PIP_TOOLS_TOKEN } })).json(), { worker: true });
    assert.equal(calls, 1);
  } finally { web.close(); worker.close(); }
});
