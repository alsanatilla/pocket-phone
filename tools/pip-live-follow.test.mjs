import test from 'node:test';
import assert from 'node:assert/strict';

// The tab's side of a streamed reply, against a fake socket: it applies numbered changes as they come, asks for what
// it missed when a number is skipped, and hands the chat blocks to draw.
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
globalThis.location = { protocol: 'http:', host: 'pocket.test' };

const { diffReply, emptyReply, replyOf } = await import('../src/shared/pip-blocks.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const view = (status, turn) => ({ run: { runId: 'run-1', chat: 'chat-1', turnUid: 'turn-1', requestId: 'attempt-1', status, turn, created: 1, updated: 2, expiresAt: 0 }, requests: [], events: [], cursor: 0 });

// The server's side: a log of numbered changes, built with the same code the real encoder uses.
const log = []; let state = emptyReply(), record = view('running', { answer: '', reasoning: '', activity: [], sources: [], usage: {}, phase: 'requesting' });
const change = answer => { const next = structuredClone(replyOf({ answer, phase: 'writing', model: 'm' })); log.push({ seq: log.length + 1, ops: diffReply(state, next) }); state = next; return log.at(-1); };
const resumes = [];
let socket;
globalThis.WebSocket = class {
  constructor() { socket = this; queueMicrotask(() => this.onmessage({ data: JSON.stringify({ type: 'hello', accountId: 'u1', at: 1 }) })); }
  emit(message) { this.onmessage({ data: JSON.stringify(message) }); }
  delta(event) { this.emit({ type: 'event', event: 'run', data: { type: 'run', kind: 'delta', runId: 'run-1', chat: 'chat-1', requestId: 'attempt-1', ...event } }); }
  send(raw) {
    const message = JSON.parse(raw);
    queueMicrotask(() => {
      if (message.method === 'pip.runs') this.emit({ type: 'res', id: message.id, ok: true, payload: record });
      if (message.method === 'run.resume') { resumes.push(message.params.after); this.emit({ type: 'res', id: message.id, ok: true, payload: { seq: log.length, events: log.filter(event => event.seq > message.params.after) } }); }
    });
  }
  close() {}
};
globalThis.fetch = async url => {
  const path = String(url), json = value => new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } });
  if (path.includes('/api/status')) return json({ configured: true });
  if (path.includes('/api/auth/get-session')) return json({ user: { id: 'u1', name: 'Fixture' } });
  return json(record);
};

const cloud = await import('../src/client/cloud.js');
const live = await import('../src/client/live.js');
const { streamReplyRemote } = await import('../src/client/pip-remote.js');
await cloud.init(); live.start('u1'); await sleep(5);

test('a streamed reply is drawn from numbered changes; a skipped number is asked for, and nothing is shown twice', async () => {
  assert.equal(live.connected(), true);
  const chat = { uid: 'chat-1', title: 'Fixture', created: 1, config: { provider: 'compatible', model: 'm', baseUrl: 'https://model.example/v1', maxTokens: 4096, thinking: false, webSearch: false } };
  const updates = [];
  const reply = streamReplyRemote(chat, { uid: 'turn-1', text: 'Hallo', attempt: 'attempt-1', context: [] }, { storage: localStorage, onUpdate: update => updates.push(update) });
  await sleep(20);
  socket.delta(change('Die Lage'));
  socket.delta(change('Die Lage ist ruhig.'));
  await sleep(5);
  assert.deepEqual(updates.at(-1).blocks, [{ kind: 'prose', key: 'p0', text: 'Die Lage ist ruhig.' }]);
  assert.equal(updates.at(-1).answer, 'Die Lage ist ruhig.');
  // Event 3 is lost on the way; 4 arrives. The tab asks for what follows 2 and ends up exact.
  change('Die Lage ist ruhig.\n\n```pocket\n{"op":"add","path":"/root","value":"m"}\n');
  socket.delta(change('Die Lage ist ruhig.\n\n```pocket\n{"op":"add","path":"/root","value":"m"}\n{"op":"add","path":"/elements/m","value":{"type":"Metric","props":{"label":"Fälle","value":1233},"children":[]}}\n```\n\nMehr nicht.'));
  await sleep(10);
  assert.deepEqual(resumes.filter(after => after > 0), [2]);
  assert.deepEqual(updates.at(-1).blocks.map(block => [block.kind, block.key]), [['prose', 'p0'], ['card', 'c1'], ['prose', 'p2']]);
  assert.equal(updates.at(-1).blocks[1].closed, true);
  // An old event again changes nothing.
  const count = updates.length; socket.delta(log[1]); await sleep(5);
  assert.equal(updates.length, count);
  // The record lags behind the stream while the run is running: reading it does not move the screen backwards.
  socket.emit({ type: 'event', event: 'run', data: { type: 'run', kind: 'started', runId: 'run-1', chat: 'chat-1' } });
  await sleep(10);
  assert.match(updates.at(-1).answer, /Mehr nicht\.$/);
  // The end comes from the record, which is final.
  record = view('done', { answer: 'Die Lage ist ruhig.\n\nMehr nicht.', reasoning: '', activity: [], sources: [], usage: {}, phase: 'done' });
  socket.emit({ type: 'event', event: 'run', data: { type: 'run', kind: 'done', runId: 'run-1', chat: 'chat-1' } });
  const done = await reply;
  assert.equal(done.answer, 'Die Lage ist ruhig.\n\nMehr nicht.'); assert.equal(done.blocks, undefined, 'the finished turn carries text, not live blocks');
  live.stop();
});
