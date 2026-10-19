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

  const state = await serverRuns({ chat: 'chat-1', force: true });
  assert.equal(state.available, true);

  const reply = await streamReplyRemote(chat, turn, { approve, onUpdate: update => updates.push(update), storage: localStorage });
  assert.equal(reply.answer, 'Die Notiz ist gespeichert.');

  // One submit, and it carries the turn's attempt as its request id (a retry reuses the same run).
  const submits = calls.filter(call => call.body?.action === 'submit');
  assert.equal(submits.length, 1);
  assert.equal(submits[0].body.requestId, 'attempt-1');
  assert.equal(submits[0].body.chatUid, 'chat-1');
  assert.equal(submits[0].body.text, 'Speichere die Notiz.');
  assert.equal(submits[0].body.accountId, 'u1');
  assert.ok(submits[0].body.device);

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
