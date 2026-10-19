import test from 'node:test';
import assert from 'node:assert/strict';

// A fake Pocket server: the client transport submits, watches, decides and finishes against it.
class Memory {
  values = new Map();
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i] ?? null; }
  getItem(k) { return this.values.get(k) ?? null; }
  setItem(k, v) { this.values.set(k, String(v)); }
  removeItem(k) { this.values.delete(k); }
}
globalThis.localStorage = new Memory(); globalThis.sessionStorage = new Memory();
localStorage.setItem('pocket:active-account', 'u1');

const calls = [];
let polls = 0;
const view = (status, turn, requests = []) => ({ run: { runId: 'run-1', chat: 'chat-1', turnUid: 'turn-1', requestId: 'req-1', status, turn, created: 1, updated: 2, expiresAt: 0 }, requests, events: [], cursor: polls });
const request0 = { id: 'req-a', row: 'row-1', kind: 'write', tool: 'create_record', state: 'pending', payload: { action: { tool: 'create_record', kind: 'note', title: 'Blue car' } }, response: null, by: '', at: 0 };

globalThis.fetch = async (url, options = {}) => {
  const path = String(url), method = options.method || 'GET', body = options.body ? JSON.parse(options.body) : null;
  calls.push({ path, method, body });
  const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  if (path.includes('/api/status')) return json({ configured: true });
  if (path.includes('/api/auth/get-session')) return json({ user: { id: 'u1', name: 'Fixture' } });
  if (path.startsWith('/api/pip/runs') && method === 'GET' && path.includes('chat=')) return json({ available: true, grants: ['notes'], web: false, run: null });
  // This host cannot stream: the client must fall back to asking again.
  if (path.includes('/api/pip/runs/stream')) return json({});
  if (path.startsWith('/api/pip/runs') && method === 'GET') { polls++; return json(polls === 1 ? view('running', { answer: 'Ich schaue', reasoning: '', activity: [], sources: [], usage: {}, phase: 'writing' }) : polls === 2 ? view('awaiting', { answer: 'Ich schaue nach', activity: [], sources: [], usage: {}, phase: 'waiting for your approval' }, [request0]) : view('done', { answer: 'Die Notiz ist gespeichert.', activity: [{ id: 'row-1', name: 'create_record', state: 'done' }], sources: [], usage: { input_tokens: 10 }, phase: 'done' })); }
  if (method === 'POST') return json(view('running', {}));
  return json({});
};

const cloud = await import('../src/client/cloud.js');
const { serverRuns, streamReplyRemote } = await import('../src/client/pip-remote.js');
await cloud.init();

test('a remote reply submits once, shows progress, asks for the approval and returns the answer', async () => {
  const chat = { uid: 'chat-1', title: 'Fixture', created: 1, config: { provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', maxTokens: 4096, thinking: false, webSearch: false } };
  const turn = { uid: 'turn-1', text: 'Speichere die Notiz.', context: [], attempt: 'attempt-1' };
  const updates = [], seen = [];
  const approve = async requests => { seen.push(...requests); return new Map(requests.map(item => [item.toolCallId, { approved: true, input: { kind: 'note', title: 'Blue car', text: '21,000' } }])); };

  // The chat's own access and timezone travel with the submit: a server run on this account's vaulted key has no
  // settings of its own to read them from.
  localStorage.setItem('pocket:pip-access:anthropic|https://api.anthropic.com/v1', JSON.stringify(['notes', 'calendar']));
  const state = await serverRuns({ chat: 'chat-1', config: chat.config, force: true });
  assert.equal(state.available, true);

  const reply = await streamReplyRemote(chat, turn, { approve, onUpdate: update => updates.push(update), storage: localStorage });
  assert.equal(reply.answer, 'Die Notiz ist gespeichert.');

  // One submit, and it carries the turn's attempt as its request id (a retry reuses the same run).
  const submits = calls.filter(call => call.body?.action === 'submit');
  assert.equal(submits.length, 1);
  assert.equal(submits[0].body.requestId, 'attempt-1');
  assert.equal(submits[0].body.attempt, 'attempt-1');
  assert.equal(submits[0].body.turnUid, 'turn-1');
  assert.equal(submits[0].body.chatUid, 'chat-1');
  assert.equal(submits[0].body.text, 'Speichere die Notiz.');
  assert.equal(submits[0].body.accountId, 'u1');
  assert.ok(submits[0].body.device);
  assert.deepEqual(submits[0].body.grants, ['notes', 'calendar']);
  assert.ok(submits[0].body.timezone, 'the chat’s timezone reached the server');
  // The state check names this chat's endpoint, so the server can find the vaulted key before the chat is synced.
  const stateCall = calls.find(call => call.method === 'GET' && call.path.includes('chat=chat-1'));
  assert.match(stateCall.path, /provider=anthropic/); assert.match(stateCall.path, /baseUrl=/);

  // Progress arrives while the run works, including its phase (the submit's first snapshot is still empty).
  assert.equal(updates.some(update => update.answer === 'Ich schaue'), true);
  assert.equal(updates.some(update => update.answer === 'Ich schaue nach'), true);
  assert.equal(updates.some(update => update.phase === 'writing'), true);

  // The approval is asked with the activity row the card belongs to, then settled with the user's edit.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].rowId, 'row-1');
  assert.equal(seen[0].toolName, 'create_record');
  const decisions = calls.filter(call => call.body?.action === 'decide');
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].body.requestId, 'req-a');
  assert.equal(decisions[0].body.approved, true);
  assert.deepEqual(decisions[0].body.input, { kind: 'note', title: 'Blue car', text: '21,000' });
});

test('a stopped run is reported as stopped, not as a failure', async () => {
  polls = 0;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url), method = options.method || 'GET';
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.includes('/api/status')) return json({ configured: true });
    if (path.includes('/api/auth/get-session')) return json({ user: { id: 'u1' } });
    if (method === 'GET') return json(view('stopped', { answer: '', error: 'Stopped. Continue or retry when you’re ready.', activity: [], sources: [], usage: {} }));
    return json(view('stopped', {}));
  };
  await assert.rejects(() => streamReplyRemote({ uid: 'chat-1', title: 'Fixture', created: 1, config: { provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', maxTokens: 4096 } }, { uid: 'turn-2', text: 'Hallo', attempt: 'attempt-2' }, { storage: localStorage }), error => error.name === 'RunStopped');
});

/** A server-sent stream of the views a follower reads: data frames, then a keep-alive comment. */
const sse = values => new Response(new ReadableStream({
  start(controller) {
    const encoder = new TextEncoder();
    for (const value of values) controller.enqueue(encoder.encode('data: ' + JSON.stringify(value) + '\n\n'));
    controller.enqueue(encoder.encode(': keep-alive\n\n'));
    controller.close();
  }
}), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } });

test('a remote reply reads the run from live frames, and asks again only when streaming is unavailable', async () => {
  calls.length = 0;
  const live = view('running', { answer: 'Ich schaue', activity: [], sources: [], usage: {}, phase: 'writing' });
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url), method = options.method || 'GET', post = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method, body: post });
    const json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
    if (path.includes('/api/status')) return json({ configured: true });
    if (path.includes('/api/auth/get-session')) return json({ user: { id: 'u1' } });
    if (path.includes('/api/pip/runs/stream')) return sse([
      { ...live, cursor: 3 },
      { ...view('awaiting', { answer: 'Ich schaue nach', activity: [], sources: [], usage: {}, phase: 'waiting for your approval' }, [request0]), cursor: 4 },
      { ...view('done', { answer: 'Die Notiz ist gespeichert.', activity: [], sources: [], usage: {}, phase: 'done' }), cursor: 5 }
    ]);
    if (method === 'GET') return json(live);
    return json(view('running', { answer: '', activity: [], sources: [], usage: {} }));
  };
  const updates = [], decisions = [];
  const approve = async requests => { decisions.push(...requests); return new Map(requests.map(item => [item.toolCallId, { approved: true, input: { kind: 'note', title: 'Blue car', text: '21,000' } }])); };
  const reply = await streamReplyRemote({ uid: 'chat-1', title: 'Fixture', created: 1, config: { provider: 'anthropic', model: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/v1', maxTokens: 4096, thinking: false, webSearch: false } },
    { uid: 'turn-3', text: 'Speichere die Notiz.', attempt: 'attempt-3' }, { approve, onUpdate: update => updates.push(update), storage: localStorage });
  assert.equal(reply.answer, 'Die Notiz ist gespeichert.');
  // The frames carried the phases, and the approval was settled on the run the frames named.
  assert.deepEqual(updates.map(update => update.phase), ['requesting', 'writing', 'waiting for your approval', 'done']);
  assert.equal(decisions.length, 1); assert.equal(decisions[0].rowId, 'row-1');
  assert.equal(calls.filter(call => call.body?.action === 'decide').length, 1);
  // The frames were the only watch: no poll of the run while the stream was open.
  assert.equal(calls.filter(call => call.method === 'GET' && call.path.includes('run=') && !call.path.includes('stream')).length, 0);
  const streamed = calls.find(call => call.path.includes('/api/pip/runs/stream'));
  assert.match(streamed.path, /run=run-1/); assert.match(streamed.path, /after=0/);
});
