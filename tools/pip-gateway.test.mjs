import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

// A fake OpenClaw Responses endpoint: each request plays the next step of a script, so the client's whole contract
// (SSE, function_call, function_call_output, previous_response_id, approval) is exercised without a gateway.
const requests = [];
let script = [];
const server = createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    const body = JSON.parse(raw); requests.push({ url: req.url, auth: req.headers.authorization, body });
    const step = script.shift() || { text: 'done' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (event, data) => res.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
    send('response.created', { response: { id: 'resp_1' } });
    if (step.call) send('response.output_item.done', { item: { type: 'function_call', name: step.call, call_id: step.id || 'call_1', arguments: JSON.stringify(step.arguments || {}) } });
    if (step.text) send('response.output_text.delta', { delta: step.text });
    send('response.completed', { response: { id: 'resp_' + requests.length, status: 'completed', usage: { input_tokens: 10, output_tokens: step.text ? 8 : 2 } } });
    res.write('data: [DONE]\n\n');
    res.end();
  });
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
process.env.PIP_GATEWAY_URL = 'http://127.0.0.1:' + server.address().port;
process.env.PIP_GATEWAY_TOKEN = 'test-token';
test.after(() => server.close());
const { gatewayConfigured, gatewayReply, gatewayTools } = await import('../src/server/pip-gateway.js');
const base = { input: [{ role: 'user', content: 'Go.' }], instructions: 'You are Pip.', tools: [] };

test('a reply streams text, runs the tool Pocket owns, and continues with its output', async () => {
  const start = requests.length;
  script = [{ call: 'echo', arguments: { text: 'hi' } }, { text: 'The tool said hi.' }];
  assert.equal(gatewayConfigured(), true);
  const deltas = [], ran = [];
  const result = await gatewayReply({ ...base, execute: async (callId, name, input) => { ran.push({ callId, name, input }); return { ok: true, said: input.text }; },
    onText: delta => deltas.push(delta) });
  assert.equal(result.answer, 'The tool said hi.');
  assert.deepEqual(ran, [{ callId: 'call_1', name: 'echo', input: { text: 'hi' } }]);
  assert.deepEqual(deltas, ['The tool said hi.']);
  assert.equal(requests[0].auth, 'Bearer test-token');
  assert.equal(requests[start + 1].body.previous_response_id, 'resp_1');
  assert.deepEqual(requests[start + 1].body.input, [{ type: 'function_call_output', call_id: 'call_1', output: '{"ok":true,"said":"hi"}' }]);
});

test('a write is previewed, approved with an edited input, and only then executed', async () => {
  const start = requests.length;
  script = [{ call: 'create_record', arguments: { kind: 'task', title: 'Original' } }, { text: 'Saved.' }];
  const seen = [], asked = [];
  const result = await gatewayReply({ ...base, writes: ['create_record'],
    preview: async (name, input) => { seen.push(['preview', name, input]); return { action: { tool: name, title: input.title } }; },
    approve: async requestsToAsk => { asked.push(...requestsToAsk); return new Map(requestsToAsk.map(item => [item.toolCallId, { approved: true, input: { ...item.input, title: 'Edited' } }])); },
    execute: async (id, name, input) => { seen.push(['execute', name, input]); return { saved: true }; } });
  assert.equal(result.answer, 'Saved.');
  assert.deepEqual(seen, [['preview', 'create_record', { kind: 'task', title: 'Original' }], ['execute', 'create_record', { kind: 'task', title: 'Edited' }]]);
  assert.equal(asked[0].toolName, 'create_record');
  assert.equal(asked[0].input.title, 'Original');
  assert.deepEqual(JSON.parse(requests[start + 1].body.input[0].output), { saved: true });
});

test('a declined write never runs, and the model hears that the person declined', async () => {
  const start = requests.length;
  script = [{ call: 'create_record', arguments: { kind: 'task', title: 'No' } }, { text: 'Okay, not saved.' }];
  const ran = [];
  const result = await gatewayReply({ ...base, writes: ['create_record'],
    preview: async name => ({ action: { tool: name, title: 'No' } }),
    approve: async requestsToAsk => new Map(requestsToAsk.map(item => [item.toolCallId, { approved: false }])),
    execute: async (id, name, input) => { ran.push(name); return { saved: true }; } });
  assert.deepEqual(ran, []);
  assert.equal(result.answer, 'Okay, not saved.');
  assert.equal(JSON.parse(requests[start + 1].body.input[0].output).action.status, 'declined');
});

test('Pocket tools become gateway client tools with their own schemas', () => {
  const tools = gatewayTools({ notes: true, grants: ['notes'] }, ['search_notes', 'show_card']);
  assert.deepEqual(tools.map(tool => tool.name), ['search_notes', 'show_card']);
  assert.equal(tools[0].type, 'function');
  assert.match(tools[0].description, /note/i);
  assert.equal(tools[0].parameters.type, 'object');
});

test('a write pauses a durable run, and the resume runs what the person approved', async () => {
  const start = requests.length;
  script = [{ call: 'create_record', id: 'call_w', arguments: { kind: 'task', title: 'Original' } }];
  let saved = null;
  await assert.rejects(gatewayReply({ ...base, writes: ['create_record'],
    preview: async (name, input) => ({ action: { tool: name, title: input.title } }),
    execute: async () => ({ saved: true }),
    durable: { checkpoint: null, settled: null, pause: async state => { saved = state; } } }), error => error.name === 'RunPaused');
  assert.equal(saved.runtime, 'gateway');
  assert.match(saved.responseId, /^resp_/);
  assert.deepEqual(saved.pending.map(item => [item.toolName, item.input.title]), [['create_record', 'Original']]);
  assert.equal(saved.previews.call_w.action.title, 'Original');

  // The person approved with a new title: the resume executes that, not the model's original.
  script = [{ text: 'Saved it.' }];
  const executed = [];
  const resumed = await gatewayReply({ ...base, writes: ['create_record'],
    execute: async (id, name, input) => { executed.push([name, input]); return { saved: true }; },
    durable: { checkpoint: saved, settled: new Map([['call_w', { approved: true, input: { kind: 'task', title: 'Edited' } }]]), pause: async () => {} } });
  assert.deepEqual(executed, [['create_record', { kind: 'task', title: 'Edited' }]]);
  assert.equal(resumed.answer, 'Saved it.');
  const follow = requests[start + 1].body;
  assert.equal(follow.previous_response_id, saved.responseId);
  assert.deepEqual(JSON.parse(follow.input[0].output), { saved: true });
});

test('a declined write on resume runs nothing and the model hears it', async () => {
  const saved = { runtime: 'gateway', responseId: 'resp_9', answer: 'Before.', usage: {},
    calls: [{ call_id: 'call_d', name: 'create_record', arguments: '{"title":"No"}' }],
    pending: [{ approvalId: 'gw-call_d', toolCallId: 'call_d', toolName: 'create_record', input: { title: 'No' }, rowId: 'call_d' }],
    previews: { call_d: { action: { tool: 'create_record', title: 'No' } } } };
  const start = requests.length;
  script = [{ text: 'Okay.' }];
  const ran = [];
  const result = await gatewayReply({ ...base, writes: ['create_record'], execute: async (id, name) => { ran.push(name); return { saved: true }; },
    durable: { checkpoint: saved, settled: new Map([['call_d', { approved: false }]]), pause: async () => {} } });
  assert.deepEqual(ran, []);
  assert.equal(result.answer, 'Before.Okay.');
  assert.equal(JSON.parse(requests[start].body.input[0].output).action.status, 'declined');
});
